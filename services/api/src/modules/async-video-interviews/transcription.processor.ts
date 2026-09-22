import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';
import { DatabaseService, type Queryable } from '@/modules/database';
import { SessionsRepository, TranscriptRepository } from '@/modules/sessions';
import { AsyncVideoTranscriptionService } from './transcription.service';
import { TranscriptionDlqService } from './transcription-dlq.service';
import {
  getTranscriptionQueueName,
  type TranscriptionJobData,
  type TranscriptionJobResult,
} from './transcription.queue';

@Injectable()
export class TranscriptionProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<TranscriptionJobData, TranscriptionJobResult> | undefined;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly db: DatabaseService,
    private readonly transcription: AsyncVideoTranscriptionService,
    private readonly transcript: TranscriptRepository,
    private readonly sessions: SessionsRepository,
    private readonly dlq: TranscriptionDlqService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<TranscriptionJobData, TranscriptionJobResult>(
      getTranscriptionQueueName(),
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

  private async process(
    job: Job<TranscriptionJobData, TranscriptionJobResult>,
  ): Promise<TranscriptionJobResult> {
    const { transcriptId, objectName, sessionId, questionId, inviteId: _inviteId } = job.data;

    return this.db.transaction(async (q) => {
      await this.markRunning(transcriptId, q);

      const transcript = await this.transcription.transcribe(objectName);

      await this.markCompleted(transcriptId, transcript, q);
      await this.updateAnswerTranscript(transcriptId, transcript, q);
      await this.appendMediaRef(sessionId, questionId, transcript, q);

      return { transcript };
    });
  }

  private async markRunning(transcriptId: string, q: Queryable): Promise<void> {
    const result = await q.query(
      `UPDATE transcription_job
       SET status = 'running', started_at = now()
       WHERE transcript_id = $1 AND status IN ('pending', 'failed')
       RETURNING id`,
      [transcriptId],
    );
    if (result.rowCount === 0) {
      throw new Error(
        `transcription job for transcript ${transcriptId} is not available for processing`,
      );
    }
  }

  private async markCompleted(
    transcriptId: string,
    transcript: string,
    q: Queryable,
  ): Promise<void> {
    await q.query(
      `UPDATE transcription_job
       SET status = 'completed', result = $1, completed_at = now()
       WHERE transcript_id = $2`,
      [transcript, transcriptId],
    );
  }

  private async updateAnswerTranscript(
    transcriptId: string,
    transcript: string,
    q: Queryable,
  ): Promise<void> {
    const row = await this.transcript.findById(transcriptId, q);
    if (!row) {
      throw new Error(`session_transcript row ${transcriptId} not found`);
    }
    const answerData = (row.answerData as unknown as Record<string, unknown> | undefined) ?? {};
    const videoAnswer =
      (answerData.videoAnswer as unknown as Record<string, unknown> | undefined) ?? {};
    await this.transcript.answer(transcriptId, transcript, q, undefined, {
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

  private async moveToDlq(job: Job<TranscriptionJobData>, error: Error): Promise<void> {
    const { transcriptId, objectName, sessionId, questionId } = job.data;
    await this.dlq.insert({
      jobId: job.id ?? 'unknown',
      transcriptId,
      objectName,
      sessionId,
      questionId,
      errorMessage: error.message,
      attempts: job.attemptsMade,
    });
  }
}
