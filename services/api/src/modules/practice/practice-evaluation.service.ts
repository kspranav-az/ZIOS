import { Inject, Injectable } from '@nestjs/common';
import type { CommunicationMetrics } from '@zios/shared-types';
import { JUDGE_PORT, computeCommunicationMetrics, type JudgePort } from '@/modules/evaluation';
import { LlmGateway } from '@/modules/llm-gateway';
import { DatabaseService } from '@/modules/database';
import {
  PracticeReportRepository,
  type CoachingTip,
  type PracticeReportRecord,
} from './practice-report.repository';
import {
  computeReadiness,
  computeStreak,
  PRACTICE_DAILY_COMPLETION_CAP,
  READINESS_WINDOW,
} from './readiness';
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
      await this.generateCoachingTips(completed);
      const withTips = await this.reports.findBySessionId(sessionId);
      if (!withTips) {
        throw new Error('practice report disappeared after coaching tips');
      }
      return withTips;
    } catch (error) {
      await this.reports.updateFailed(
        report.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Coaching tips (LLM task `coaching_tips` v1.0.0): runs after the judge
   * report completes. Idempotent — a report that already has tips is returned
   * untouched (safe to retry). Tips never fail the report: on error the tips
   * are left null and the completed report stands.
   */
  private async generateCoachingTips(report: PracticeReportRecord): Promise<void> {
    if (report.status !== 'completed' || report.coachingTips !== null) {
      return;
    }
    const session = await this.sessions.findById(report.sessionId);
    if (!session) return;
    const spans = await this.reports.listEvidenceSpans(report.id);
    const scores = await this.reports.listScores(report.id);

    try {
      const result = await this.llmGateway.complete<{ tips: CoachingTip[] }>({
        task: 'coaching_tips',
        variables: {
          metrics: report.communicationMetrics,
          scores,
          evidence: spans.map((span) => ({
            questionId: span.questionId,
            quoteText: span.quoteText,
          })),
        },
        // orgId is the candidate account id — pure attribution label (D9).
        orgId: report.accountId,
        sessionId: report.sessionId,
      });
      const tips = (result.parsed.tips ?? []).filter(
        (tip) =>
          typeof tip.tip === 'string' &&
          tip.tip.length > 0 &&
          typeof tip.quoteText === 'string' &&
          spans.some((span) => span.quoteText === tip.quoteText),
      );
      if (tips.length === 0) return;
      const journalEntries = this.llmGateway
        .getJournal()
        .filter(
          (entry) => entry.sessionId === report.sessionId && entry.task === 'coaching_tips',
        );
      const tipsCost = journalEntries.reduce((sum, entry) => sum + entry.cost, 0);
      await this.reports.updateCoachingTips(report.id, tips, tipsCost);
    } catch {
      // Coaching is additive by design — a tips failure must not fail the report.
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
    return {
      report,
      scores,
      evidenceSpans,
      transcript,
      coachingTips: report.coachingTips ?? [],
    };
  }

  /** Progress view: session history, per-metric trends, and the practice streak. */
  async getProgress(accountId: string) {
    const history = await this.reports.listHistoryByAccount(accountId);
    const completed = history
      .filter((row) => row.status === 'completed' && row.completedAt !== null)
      .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
    const details = await Promise.all(
      completed.map(async (row) => {
        const report = await this.reports.findBySessionId(row.id);
        return {
          completedAt: row.completedAt as string,
          overallRecommendation: row.overallRecommendation,
          paceWpm: report?.communicationMetrics?.paceWpm ?? null,
          fillerCount: report?.communicationMetrics?.fillerCount ?? null,
        };
      }),
    );
    const streak = computeStreak(
      completed.map((row) => (row.completedAt as string).slice(0, 10)),
    );
    return {
      sessions: history,
      trends: details,
      streak: { current: streak },
      dailyCap: PRACTICE_DAILY_COMPLETION_CAP,
    };
  }

  /** Readiness view: deterministic formula over the last judged sessions. */
  async getReadiness(accountId: string) {
    const inputs = await this.reports.listReadinessInputs(accountId, READINESS_WINDOW);
    return computeReadiness(
      inputs.map((row) => ({
        overallRecommendation: row.overallRecommendation,
        communicationMetrics: row.communicationMetrics as CommunicationMetrics | null,
      })),
    );
  }
}
