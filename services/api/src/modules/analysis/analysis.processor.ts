import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';
import { DatabaseService, type Queryable } from '@/modules/database';
import { ConsentService } from '@/modules/consent';
import { SessionsRepository, TranscriptRepository } from '@/modules/sessions';
import {
  AnalysisOrchestratorClient,
  AnalysisOrchestratorError,
} from './analysis-orchestrator.client';
import { AnalysisRepository } from './analysis.repository';
import {
  getAnalysisQueueName,
  type AnalysisJobData,
  type AnalysisJobResult,
} from './analysis.queue';

/**
 * Job-level failure with a stable error code. Used for failures detected
 * before the orchestrator call (e.g. consent gating) so the DLQ row carries
 * a typed error_code just like orchestrator failures.
 */
export class AnalysisJobError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnalysisJobError';
  }
}

@Injectable()
export class AnalysisProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<AnalysisJobData, AnalysisJobResult> | undefined;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly db: DatabaseService,
    private readonly client: AnalysisOrchestratorClient,
    private readonly repo: AnalysisRepository,
    private readonly transcript: TranscriptRepository,
    private readonly sessions: SessionsRepository,
    private readonly consent: ConsentService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AnalysisJobData, AnalysisJobResult>(
      getAnalysisQueueName(),
      async (job) => this.process(job),
      { connection: this.redis },
    );

    this.worker.on('failed', async (job, err) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts) {
        await this.moveToDlq(job, err);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async process(job: Job<AnalysisJobData, AnalysisJobResult>): Promise<AnalysisJobResult> {
    const {
      analysisJobId,
      sessionId,
      questionId,
      inviteId,
      objectName,
      mediaKind,
      includeTranscript,
      languageHint,
    } = job.data;

    // Consent gate (invariant X8) — checked before the processing transaction
    // so the failed state persists. A missing artifact means the media should
    // never have been captured; we fail the job with a typed error and let the
    // retry policy exhaust into the DLQ for human review. (Retries are
    // pointless here, but consent cannot legitimately appear after capture, so
    // a missing artifact always indicates a bug worth surfacing in the DLQ.)
    const consent =
      (await this.consent.findBySessionId(sessionId)) ??
      (inviteId ? await this.consent.findByInviteId(inviteId) : null);
    if (!consent || consent.withdrawnAt) {
      const message = `no consent artifact found for session ${sessionId}; media analysis refused`;
      await this.repo.markFailed(analysisJobId, 'CONSENT_MISSING', message);
      throw new AnalysisJobError('CONSENT_MISSING', message);
    }

    return this.db.transaction(async (q) => {
      const claimed = await this.repo.markRunning(analysisJobId, q);
      if (!claimed) {
        throw new Error(`analysis job ${analysisJobId} is not available for processing`);
      }
      await this.repo.incrementAttempts(analysisJobId, q);

      const response = await this.client.analyze({
        analysis_job_id: analysisJobId,
        session_id: sessionId,
        question_id: questionId,
        object_name: objectName,
        media_kind: mediaKind,
        include_transcript: includeTranscript,
        language_hint: languageHint ?? null,
        consent_verified: true,
      });

      // Large per-level feature artifacts live in MinIO (result.objects); the
      // DB row keeps the object pointers, the Level-3 aggregate inline
      // (features, a few KB), media metadata, and pipeline metrics.
      await this.repo.markCompleted(
        analysisJobId,
        {
          result: response.result ?? null,
          features: response.features ?? null,
          media: response.media ?? null,
          metrics: response.metrics ?? null,
        },
        response.schema_version ?? null,
        q,
      );

      // Write the transcript back into session_transcript so the existing
      // employer review page keeps working (same shape the legacy
      // transcription worker produces).
      if (mediaKind === 'video' && includeTranscript && response.transcript_text && questionId) {
        await this.updateAnswerTranscript(sessionId, questionId, response.transcript_text, q);
        await this.appendMediaRef(sessionId, questionId, response.transcript_text, q);
      }

      return { status: 'completed', schemaVersion: response.schema_version ?? null };
    });
  }

  private async updateAnswerTranscript(
    sessionId: string,
    questionId: string,
    transcript: string,
    q: Queryable,
  ): Promise<void> {
    const rows = await this.transcript.listBySession(sessionId, q);
    const row = rows.find((r) => r.questionId === questionId);
    if (!row) {
      throw new Error(`session_transcript row for question ${questionId} not found`);
    }
    const answerData = (row.answerData as unknown as Record<string, unknown> | undefined) ?? {};
    const videoAnswer =
      (answerData.videoAnswer as unknown as Record<string, unknown> | undefined) ?? {};
    await this.transcript.answer(row.id, transcript, q, undefined, {
      ...answerData,
      videoAnswer: { ...videoAnswer, transcript },
    } as unknown as import('@zios/shared-types').AnswerData);
  }

  private async appendMediaRef(
    sessionId: string,
    questionId: string,
    transcript: string,
    q: Queryable,
  ): Promise<void> {
    // Best-effort media ref update for the transcript pointer.
    try {
      await this.sessions.appendMediaRef(
        sessionId,
        {
          kind: 'async_video_answer',
          questionId,
          transcript,
          recordedAt: new Date().toISOString(),
        },
        q,
      );
    } catch {
      // Non-fatal: the transcript row is the source of truth.
    }
  }

  private async moveToDlq(job: Job<AnalysisJobData>, error: Error): Promise<void> {
    const { analysisJobId, kind, sessionId, questionId } = job.data;
    let errorCode = 'PROCESSING_FAILED';
    if (error instanceof AnalysisOrchestratorError || error instanceof AnalysisJobError) {
      errorCode = error.errorCode;
    }
    // Persist the terminal failure on the job row itself (the processing
    // transaction rolled back, leaving the row 'pending'), then DLQ it.
    await this.repo.markFailed(analysisJobId, errorCode, error.message);
    await this.repo.upsertDlq({
      // BullMQ job ids are only unique within a queue; prefix with the queue
      // name so reruns on fresh queues cannot collide with older DLQ rows.
      jobId: `${getAnalysisQueueName()}:${job.id ?? 'unknown'}`,
      analysisJobId,
      kind,
      sessionId,
      questionId,
      errorCode,
      errorMessage: error.message,
      attempts: job.attemptsMade,
    });
  }
}
