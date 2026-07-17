import { Inject, Injectable } from '@nestjs/common';
import type {
  EvaluationReport,
  KitQuestion,
  KitSnapshot,
  SessionTranscript,
} from '@zios/shared-types';
import { DatabaseService } from '@/modules/database';
import { ApiException } from '@/common/errors';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationScoreRepository } from './score.repository';
import { EvidenceSpanRepository } from './evidence-span.repository';
import { PipelineLogRepository } from './pipeline-log.repository';
import { OverrideRepository } from './override.repository';
import { JUDGE_PORT, type JudgePort } from './judge.port';

interface SessionContext {
  id: string;
  orgId: string;
  inviteId: string;
  kitVersionId: string;
}

@Injectable()
export class EvaluationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly reports: EvaluationRepository,
    private readonly scores: EvaluationScoreRepository,
    private readonly evidenceSpans: EvidenceSpanRepository,
    private readonly pipelineLogs: PipelineLogRepository,
    private readonly overrides: OverrideRepository,
    @Inject(JUDGE_PORT) private readonly judge: JudgePort,
  ) {}

  /**
   * Idempotently evaluates a completed interview session. Safe to retry on
   * failure; if a report already exists and is completed, it is returned as-is.
   *
   * This runs outside the interview transaction so a scoring failure does not
   * roll back the completed session state.
   */
  async evaluateSession(sessionId: string): Promise<EvaluationReport> {
    const existing = await this.reports.findBySessionId(sessionId);
    if (existing?.status === 'completed') {
      return existing;
    }

    const log = await this.pipelineLogs.insert(
      { sessionId, reportId: existing?.id ?? null },
      this.db,
    );
    const startedAt = Date.now();
    const stages: {
      name: string;
      status: 'ok' | 'error';
      ms: number;
      detail?: Record<string, unknown>;
    }[] = [];

    try {
      const stageLoad = Date.now();
      const session = await this.loadSessionContext(sessionId);
      const transcript = await this.loadTranscript(sessionId);
      const questions = await this.loadQuestions(session.kitVersionId);
      stages.push({ name: 'load_context', status: 'ok', ms: Date.now() - stageLoad });

      const report =
        existing ??
        (await this.db.transaction(async (q) =>
          this.reports.insert(
            {
              orgId: session.orgId,
              sessionId: session.id,
              inviteId: session.inviteId,
              kitVersionId: session.kitVersionId,
              status: 'pending',
            },
            q,
          ),
        ));

      // Bind the log to the report now that the report exists.
      if (log.reportId !== report.id) {
        await this.db.transaction(async (q) => {
          await q.query('UPDATE evaluation_pipeline_log SET report_id = $1 WHERE id = $2', [
            report.id,
            log.id,
          ]);
        });
      }

      const stageJudge = Date.now();
      const judgeResult = await this.judge.evaluate(
        { orgId: session.orgId, sessionId: session.id, kitVersionId: session.kitVersionId },
        transcript,
        questions,
      );
      stages.push({ name: 'judge', status: 'ok', ms: Date.now() - stageJudge });

      const stageWrite = Date.now();
      await this.db.transaction(async (q) => {
        // Write evidence spans first so scores can reference them.
        const spanIdByEvidence = new Map<string, string>();
        for (const score of judgeResult.scores) {
          const span = await this.evidenceSpans.insert(
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
          await this.scores.insert(
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
            communicationMetrics: judgeResult.metrics,
            promptVersions: { stubJudge: 'phase04-stub' },
          },
          q,
        );
      });
      stages.push({ name: 'persist', status: 'ok', ms: Date.now() - stageWrite });

      const totalMs = Date.now() - startedAt;
      await this.pipelineLogs.updateCompleted(log.id, stages, totalMs, this.db);

      const completed = await this.reports.findById(report.id);
      if (!completed) {
        throw new Error('report disappeared after completion');
      }
      return completed;
    } catch (error) {
      const reportId = existing?.id ?? null;
      if (reportId) {
        await this.reports.updateFailed(
          reportId,
          error instanceof Error ? error.message : String(error),
          this.db,
        );
      }
      stages.push({
        name: 'pipeline',
        status: 'error',
        ms: Date.now() - startedAt,
        detail: { message: error instanceof Error ? error.message : String(error) },
      });
      await this.pipelineLogs.updateCompleted(log.id, stages, Date.now() - startedAt, this.db);
      throw error;
    }
  }

  async findDetail(orgId: string, sessionId: string) {
    const report = await this.reports.findBySessionId(sessionId);
    if (!report || report.orgId !== orgId) {
      throw new ApiException(404, 'REPORT_NOT_FOUND', 'report not found');
    }
    const [scores, evidenceSpans, overrides, transcript] = await Promise.all([
      this.scores.listByReportId(report.id),
      this.evidenceSpans.listByReportId(report.id),
      this.overrides.listByReportId(report.id),
      this.loadTranscript(sessionId),
    ]);
    return { report, scores, evidenceSpans, overrides, transcript };
  }

  /**
   * Loads a report and its scoring data by report id without org scoping.
   * Intended for public share-link resolution, which has already validated
   * the token and expiry.
   */
  async findDetailByReportId(reportId: string) {
    const report = await this.reports.findById(reportId);
    if (!report) {
      throw new ApiException(404, 'REPORT_NOT_FOUND', 'report not found');
    }
    const [scores, evidenceSpans, transcript] = await Promise.all([
      this.scores.listByReportId(report.id),
      this.evidenceSpans.listByReportId(report.id),
      this.loadTranscript(report.sessionId),
    ]);
    return { report, scores, evidenceSpans, transcript };
  }

  async listForOrg(
    orgId: string,
    filters: {
      status?: 'pending' | 'completed' | 'failed';
      q?: string;
      page: number;
      pageSize: number;
    },
  ) {
    return this.reports.listByOrg(orgId, filters);
  }

  private async loadSessionContext(sessionId: string): Promise<SessionContext> {
    const result = await this.db.query(
      `SELECT s.id, s.invite_id, i.org_id, s.kit_version_id
       FROM interview_session s
       JOIN invite i ON i.id = s.invite_id
       WHERE s.id = $1`,
      [sessionId],
    );
    const row = result.rows[0] as
      { id: string; invite_id: string; org_id: string; kit_version_id: string } | undefined;
    if (!row) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
    return {
      id: row.id,
      inviteId: row.invite_id,
      orgId: row.org_id,
      kitVersionId: row.kit_version_id,
    };
  }

  private async loadTranscript(sessionId: string): Promise<SessionTranscript[]> {
    const result = await this.db.query(
      `SELECT id, session_id, question_id, question_prompt, answer_text, position, evidence_span, created_at, answered_at
       FROM session_transcript
       WHERE session_id = $1
       ORDER BY position ASC, created_at ASC`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      questionId: row.question_id as string,
      questionPrompt: row.question_prompt as string,
      answerText: row.answer_text as string | null,
      position: row.position as number,
      evidenceSpan: (row.evidence_span ?? []) as Array<{
        start: number;
        end: number;
        transcriptId: string;
      }>,
      createdAt: (row.created_at as Date).toISOString(),
      answeredAt: row.answered_at ? (row.answered_at as Date).toISOString() : null,
    }));
  }

  private async loadQuestions(kitVersionId: string): Promise<KitQuestion[]> {
    const result = await this.db.query('SELECT snapshot FROM kit_version WHERE id = $1', [
      kitVersionId,
    ]);
    const snapshot = result.rows[0]?.snapshot as KitSnapshot | undefined;
    if (!snapshot) {
      throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
    }
    return snapshot.questions;
  }
}
