import { Inject, Injectable } from '@nestjs/common';
import type {
  AppUser,
  EvaluationReport,
  HumanScorecardBody,
  InterviewNotes,
  InterviewSession,
  KitQuestion,
  KitSnapshot,
  SessionTranscript,
} from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';
import { LlmGateway } from '@/modules/llm-gateway';
import { ApiException } from '@/common/errors';
import {
  WebhookFanoutService,
  WebhooksQueue,
  type WebhookDelivery,
} from '@/modules/webhooks';
import { computeCommunicationMetrics } from './metrics';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationScoreRepository } from './score.repository';
import { EvidenceSpanRepository } from './evidence-span.repository';
import { PipelineLogRepository } from './pipeline-log.repository';
import { OverrideRepository } from './override.repository';
import { InterviewNotesRepository } from './notes.repository';
import { JUDGE_PORT, type JudgePort } from './judge.port';

interface SessionContext {
  id: string;
  orgId: string;
  inviteId: string;
  kitVersionId: string;
  conductor: InterviewSession['conductor'];
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
    private readonly notesRepo: InterviewNotesRepository,
    @Inject(JUDGE_PORT) private readonly judge: JudgePort,
    private readonly llmGateway: LlmGateway,
    private readonly webhookFanout: WebhookFanoutService,
    private readonly webhookQueue: WebhooksQueue,
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

      // Human-facilitated sessions are scored by the interviewer via scorecard;
      // they never receive an AI-judged report. We create a pending report so
      // downstream lookups and the scorecard flow have a report id.
      if (session.conductor === 'human') {
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
                modelRoute: 'human-facilitated',
              },
              q,
            ),
          ));
        stages.push({ name: 'human_mode_pending', status: 'ok', ms: Date.now() - stageLoad });
        await this.pipelineLogs.updateCompleted(log.id, stages, Date.now() - startedAt, this.db);
        return report;
      }

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

      // Attribute AI cost from the gateway journal for this session.
      const journalEntries = this.llmGateway
        .getJournal()
        .filter((entry) => entry.sessionId === session.id);
      const attributedCost = journalEntries.reduce((sum, entry) => sum + entry.cost, 0);
      const modelRoute = journalEntries
        .map((entry) => `${entry.provider}:${entry.modelRoute}`)
        .join(',');

      const stageWrite = Date.now();
      let webhookDeliveries: WebhookDelivery[] = [];
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
            cost: attributedCost,
            promptVersions: {
              stubJudge: 'phase04-stub',
              modelRoute: modelRoute || 'mock-judge',
              journalCount: journalEntries.length,
            },
          },
          q,
        );

        // Journal report.ready and write durable webhook rows in-transaction
        // (FR-E13-4); BullMQ jobs are enqueued after this tx commits.
        webhookDeliveries = await this.journalReportReady(q, session, report.id);
      });
      stages.push({ name: 'persist', status: 'ok', ms: Date.now() - stageWrite });

      for (const delivery of webhookDeliveries) {
        await this.webhookQueue.add(delivery.id);
      }

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
    const [scores, evidenceSpans, overrides, transcript, notes] = await Promise.all([
      this.scores.listByReportId(report.id),
      this.evidenceSpans.listByReportId(report.id),
      this.overrides.listByReportId(report.id),
      this.loadTranscript(sessionId),
      this.loadNotes(report),
    ]);
    return { report: { ...report, notes }, scores, evidenceSpans, overrides, transcript, notes };
  }

  async findReportBySessionId(sessionId: string): Promise<EvaluationReport | null> {
    return this.reports.findBySessionId(sessionId);
  }

  async listScores(reportId: string) {
    return this.scores.listByReportId(reportId);
  }

  async attachNotes(reportId: string, notesId: string, q: Queryable): Promise<void> {
    await this.reports.updateNotesId(reportId, notesId, q);
  }

  private async loadNotes(report: EvaluationReport): Promise<InterviewNotes | null> {
    if (!report.notesId) return null;
    return this.notesRepo.findById(report.notesId);
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
    const [scores, evidenceSpans, transcript, notes] = await Promise.all([
      this.scores.listByReportId(report.id),
      this.evidenceSpans.listByReportId(report.id),
      this.loadTranscript(report.sessionId),
      this.loadNotes(report),
    ]);
    return { report: { ...report, notes }, scores, evidenceSpans, transcript, notes };
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

  /**
   * AI pre-fill for a human-facilitated scorecard. Reuses the judge on the
   * existing transcript so the interviewer has an editable starting point.
   * Any previous ai_prefill scores are replaced; human scores are untouched.
   */
  async prefillScorecard(orgId: string, sessionId: string, userId: string) {
    const report = await this.findOrCreateHumanReport(orgId, sessionId);
    const transcript = await this.loadTranscript(sessionId);
    const questions = await this.loadQuestions(report.kitVersionId);
    const judgeResult = await this.judge.evaluate(
      { orgId, sessionId, kitVersionId: report.kitVersionId },
      transcript,
      questions,
    );

    await this.db.transaction(async (q) => {
      await this.scores.deleteByReportId(report.id, q);
      await this.evidenceSpans.deleteByReportId(report.id, q);
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
            source: 'ai_prefill',
            scorerId: userId,
          },
          q,
        );
      }
    });

    return this.findDetail(orgId, sessionId);
  }

  /**
   * Submit a human-completed scorecard. Replaces all prior scores for the
   * report, writes fresh evidence spans, and marks the report completed.
   */
  async submitHumanScorecard(
    orgId: string,
    sessionId: string,
    user: AppUser,
    body: HumanScorecardBody,
  ) {
    const report = await this.findOrCreateHumanReport(orgId, sessionId);
    const transcript = await this.loadTranscript(sessionId);
    const metrics = computeCommunicationMetrics(transcript);

    for (const score of body.scores) {
      if (
        !Number.isFinite(score.score) ||
        !Number.isInteger(score.score) ||
        score.score < 1 ||
        score.score > 5
      ) {
        throw new ApiException(400, 'INVALID_SCORE', `score must be an integer between 1 and 5`);
      }
      if (!Number.isFinite(score.weight) || score.weight <= 0) {
        throw new ApiException(400, 'INVALID_WEIGHT', `weight must be a positive number`);
      }
    }

    const overallRaw =
      body.scores.length > 0
        ? body.scores.reduce((sum: number, s) => sum + s.score * s.weight, 0) /
          body.scores.reduce((sum: number, s) => sum + s.weight, 0)
        : 0;
    const overallRecommendation = Math.max(1, Math.min(5, Math.round(overallRaw)));

    let webhookDeliveries: WebhookDelivery[] = [];
    await this.db.transaction(async (q) => {
      await this.scores.deleteByReportId(report.id, q);
      await this.evidenceSpans.deleteByReportId(report.id, q);

      const spanIdByEvidence = new Map<string, string>();
      for (const score of body.scores) {
        const span = await this.evidenceSpans.insert(
          {
            reportId: report.id,
            transcriptId: null,
            questionId: score.questionId,
            start: 0,
            end: 0,
            quoteText: score.criterionText,
          },
          q,
        );
        spanIdByEvidence.set(`${score.questionId}:${score.criterionId}`, span.id);
      }

      for (const score of body.scores) {
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
            source: 'human',
            scorerId: user.id,
          },
          q,
        );
      }

      await this.reports.updateScorecard(
        report.id,
        {
          overallRecommendation,
          overallConfidence: 0.7,
          communicationMetrics: metrics,
          cost: 0,
          promptVersions: { source: 'human-scorecard' },
          scorecardMeta: {
            submittedAt: new Date().toISOString(),
            submittedBy: user.id,
            prefillAccepted: body.prefillAccepted,
            editCount: body.editCount,
          },
        },
        q,
      );

      webhookDeliveries = await this.journalReportReady(
        q,
        { id: sessionId, inviteId: report.inviteId },
        report.id,
      );
    });

    for (const delivery of webhookDeliveries) {
      await this.webhookQueue.add(delivery.id);
    }

    return this.findDetail(orgId, sessionId);
  }

  /**
   * Journal a `report.ready` session_event and write durable webhook rows for
   * it, all inside the caller's transaction. Returns the new deliveries; the
   * caller enqueues BullMQ jobs only after commit.
   */
  private async journalReportReady(
    q: Queryable,
    session: { id: string; inviteId: string | null },
    reportId: string,
  ): Promise<WebhookDelivery[]> {
    if (!session.inviteId) {
      return [];
    }
    const result = await q.query(
      `INSERT INTO session_event (session_id, type, payload)
       VALUES ($1, 'report.ready', $2::jsonb)
       RETURNING id, occurred_at`,
      [session.id, JSON.stringify({ report_id: reportId })],
    );
    const row = result.rows[0] as { id: string; occurred_at: Date };
    return this.webhookFanout.fanout(q, {
      sessionEventId: row.id,
      sessionId: session.id,
      inviteId: session.inviteId,
      event: 'report.ready',
      occurredAt: row.occurred_at,
    });
  }

  private async findOrCreateHumanReport(
    orgId: string,
    sessionId: string,
  ): Promise<EvaluationReport> {    const sessionContext = await this.loadSessionContext(sessionId);
    if (sessionContext.orgId !== orgId) {
      throw new ApiException(404, 'REPORT_NOT_FOUND', 'report not found');
    }
    if (sessionContext.conductor !== 'human') {
      throw new ApiException(
        409,
        'SESSION_MODE_INVALID',
        'scorecard is only for human-facilitated sessions',
      );
    }
    const existing = await this.reports.findBySessionId(sessionId);
    if (existing) return existing;
    return this.db.transaction(async (q) =>
      this.reports.insert(
        {
          orgId: sessionContext.orgId,
          sessionId: sessionContext.id,
          inviteId: sessionContext.inviteId,
          kitVersionId: sessionContext.kitVersionId,
          status: 'pending',
          modelRoute: 'human-facilitated',
        },
        q,
      ),
    );
  }

  private async loadSessionContext(sessionId: string): Promise<SessionContext> {
    const result = await this.db.query(
      `SELECT s.id, s.invite_id, s.conductor, i.org_id, s.kit_version_id
       FROM interview_session s
       JOIN invite i ON i.id = s.invite_id
       WHERE s.id = $1`,
      [sessionId],
    );
    const row = result.rows[0] as
      | {
          id: string;
          invite_id: string;
          conductor: InterviewSession['conductor'];
          org_id: string;
          kit_version_id: string;
        }
      | undefined;
    if (!row) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
    return {
      id: row.id,
      inviteId: row.invite_id,
      orgId: row.org_id,
      conductor: row.conductor,
      kitVersionId: row.kit_version_id,
    };
  }

  private async loadTranscript(sessionId: string): Promise<SessionTranscript[]> {
    const result = await this.db.query(
      `SELECT id, session_id, question_id, question_prompt, answer_text, answer_data, position, evidence_span, created_at, answered_at
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
      answerData: (row.answer_data ?? null) as SessionTranscript['answerData'],
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
