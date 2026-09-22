import { Inject, Injectable } from '@nestjs/common';
import { JUDGE_PORT, computeCommunicationMetrics, type JudgePort } from '@/modules/evaluation';
import { LlmGateway } from '@/modules/llm-gateway';
import { DatabaseService } from '@/modules/database';
import { PracticeReportRepository, type PracticeReportRecord } from './practice-report.repository';
import { PracticeSessionRepository } from './practice-session.repository';
import { PracticeTranscriptRepository } from './practice-transcript.repository';

/**
 * Practice evaluation (Phase 12, D9): runs the SAME judge port and
 * communication-metrics functions as employer evaluations, but reads the
 * practice transcript/snapshot and writes practice_report (+ scores +
 * evidence spans) — separate tables, same schema shape. The employer
 * evaluation pipeline is untouched; practice data can never surface in an
 * employer read path because the tables simply do not join.
 */
@Injectable()
export class PracticeEvaluationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: PracticeSessionRepository,
    private readonly transcript: PracticeTranscriptRepository,
    private readonly reports: PracticeReportRepository,
    @Inject(JUDGE_PORT) private readonly judge: JudgePort,
    private readonly llmGateway: LlmGateway,
  ) {}

  /** Idempotent: a completed report is returned as-is (safe to retry). */
  async evaluateSession(sessionId: string): Promise<PracticeReportRecord> {
    const existing = await this.reports.findBySessionId(sessionId);
    if (existing?.status === 'completed') {
      return existing;
    }

    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw new Error(`practice session not found: ${sessionId}`);
    }

    const report =
      existing ??
      (await this.db.transaction(async (q) =>
        this.reports.insertPending({ sessionId, accountId: session.accountId }, q),
      ));

    try {
      const rows = await this.transcript.listBySession(sessionId);
      const questions = session.snapshot.questions;
      // Judge context: sessionId drives gateway journal attribution; orgId is
      // the candidate account id — a pure attribution label, never a tenant.
      const judgeResult = await this.judge.evaluate(
        {
          orgId: session.accountId,
          sessionId: session.id,
          kitVersionId: `practice-${session.id}`,
        },
        rows,
        questions,
      );

      const journalEntries = this.llmGateway
        .getJournal()
        .filter((entry) => entry.sessionId === session.id);
      const attributedCost = journalEntries.reduce((sum, entry) => sum + entry.cost, 0);
      const modelRoute = journalEntries.map((entry) => `${entry.provider}:${entry.modelRoute}`).join(',');
      const metrics = computeCommunicationMetrics(rows);

      await this.db.transaction(async (q) => {
        const spanIdByEvidence = new Map<string, string>();
        for (const score of judgeResult.scores) {
          const span = await this.reports.insertEvidenceSpan(
            {
              reportId: report.id,
              transcriptId: score.evidenceSpan.transcriptId,
              questionId: score.evidenceSpan.questionId,
              start: score.evidenceSpan.start,
              end: score.evidenceSpan.end,
              quoteText: score.evidenceSpan.quoteText,
            },
            q,
          );
          spanIdByEvidence.set(`${score.questionId}:${score.criterionId}`, span.id);
        }
        for (const score of judgeResult.scores) {
          const spanId = spanIdByEvidence.get(`${score.questionId}:${score.criterionId}`);
          if (!spanId) {
            throw new Error(`missing evidence span for ${score.questionId}:${score.criterionId}`);
          }
          await this.reports.insertScore(
            {
              reportId: report.id,
              questionId: score.questionId,
              criterionId: score.criterionId,
              criterionText: score.criterionText,
              score: score.score,
              weight: score.weight,
              evidenceSpanIds: [spanId],
            },
            q,
          );
        }
        await this.reports.updateCompleted(
          report.id,
          {
            overallRecommendation: judgeResult.recommendation,
            overallConfidence: judgeResult.confidence,
            communicationMetrics: metrics,
            cost: attributedCost,
            modelRoute: modelRoute || 'mock-judge',
            promptVersions: {
              practiceJudge: 'phase12-stub',
              journalCount: journalEntries.length,
            },
          },
          q,
        );
      });

      const completed = await this.reports.findBySessionId(sessionId);
      if (!completed) {
        throw new Error('practice report disappeared after completion');
      }
      return completed;
    } catch (error) {
      await this.reports.updateFailed(
        report.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async findDetail(accountId: string, sessionId: string) {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.accountId !== accountId) {
      return null;
    }
    const report = await this.reports.findBySessionId(sessionId);
    if (!report || report.accountId !== accountId) {
      return null;
    }
    const [scores, evidenceSpans, transcript] = await Promise.all([
      this.reports.listScores(report.id),
      this.reports.listEvidenceSpans(report.id),
      this.transcript.listBySession(sessionId),
    ]);
    return { report, scores, evidenceSpans, transcript };
  }
}
