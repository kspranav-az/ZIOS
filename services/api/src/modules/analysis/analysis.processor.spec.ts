import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type IORedis from 'ioredis';
import type { ConsentService } from '@/modules/consent';
import type { DatabaseService, Queryable } from '@/modules/database';
import type { SessionsRepository, TranscriptRepository } from '@/modules/sessions';
import {
  AnalysisOrchestratorClient,
  AnalysisOrchestratorError,
} from './analysis-orchestrator.client';
import { AnalysisJobError, AnalysisProcessor } from './analysis.processor';
import type { AnalysisRepository } from './analysis.repository';
import { getAnalysisQueueName, type AnalysisJobData } from './analysis.queue';

interface MockDeps {
  repo: {
    markRunning: ReturnType<typeof vi.fn>;
    incrementAttempts: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    upsertDlq: ReturnType<typeof vi.fn>;
  };
  client: { analyze: ReturnType<typeof vi.fn> };
  consent: {
    findBySessionId: ReturnType<typeof vi.fn>;
    findByInviteId: ReturnType<typeof vi.fn>;
  };
  transcript: {
    listBySession: ReturnType<typeof vi.fn>;
    answer: ReturnType<typeof vi.fn>;
  };
  sessions: { appendMediaRef: ReturnType<typeof vi.fn> };
}

function buildProcessor() {
  const deps: MockDeps = {
    repo: {
      markRunning: vi.fn().mockResolvedValue(true),
      incrementAttempts: vi.fn().mockResolvedValue(undefined),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      upsertDlq: vi.fn().mockResolvedValue(undefined),
    },
    client: { analyze: vi.fn() },
    consent: {
      findBySessionId: vi.fn().mockResolvedValue(null),
      findByInviteId: vi.fn().mockResolvedValue(null),
    },
    transcript: {
      listBySession: vi.fn().mockResolvedValue([]),
      answer: vi.fn().mockResolvedValue(null),
    },
    sessions: { appendMediaRef: vi.fn().mockResolvedValue(undefined) },
  };
  // Execute the transaction callback against the mock queryable directly.
  const db = {
    transaction: vi.fn(async (fn: (q: Queryable) => Promise<unknown>) => fn({} as Queryable)),
  } as unknown as DatabaseService;

  const processor = new AnalysisProcessor(
    {} as IORedis,
    db,
    deps.client as unknown as AnalysisOrchestratorClient,
    deps.repo as unknown as AnalysisRepository,
    deps.transcript as unknown as TranscriptRepository,
    deps.sessions as unknown as SessionsRepository,
    deps.consent as unknown as ConsentService,
  );
  return { processor, deps };
}

function fakeJob(overrides: Partial<AnalysisJobData> = {}) {
  const data: AnalysisJobData = {
    analysisJobId: randomUUID(),
    kind: 'multimodal_feature_extraction',
    sessionId: randomUUID(),
    questionId: randomUUID(),
    inviteId: randomUUID(),
    objectName: 'async-video/s/q/hash.webm',
    mediaKind: 'video',
    includeTranscript: true,
    ...overrides,
  };
  return {
    id: `bullmq-${randomUUID()}`,
    data,
    attemptsMade: 3,
    opts: { attempts: 3 },
  };
}

type ProcessorInternals = {
  process(job: ReturnType<typeof fakeJob>): Promise<{ status: string }>;
  moveToDlq(job: ReturnType<typeof fakeJob>, error: Error): Promise<void>;
};

function internals(processor: AnalysisProcessor): ProcessorInternals {
  return processor as unknown as ProcessorInternals;
}

function consented(deps: MockDeps) {
  const artifact = { id: randomUUID(), withdrawnAt: null };
  deps.consent.findBySessionId.mockResolvedValue(artifact);
  return artifact;
}

describe('AnalysisProcessor consent gating (X8)', () => {
  it('fails with CONSENT_MISSING and never calls the orchestrator when no artifact exists', async () => {
    const { processor, deps } = buildProcessor();
    const job = fakeJob();

    const error = await internals(processor)
      .process(job)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AnalysisJobError);
    expect((error as AnalysisJobError).errorCode).toBe('CONSENT_MISSING');
    expect(deps.client.analyze).not.toHaveBeenCalled();
    expect(deps.repo.markFailed).toHaveBeenCalledWith(
      job.data.analysisJobId,
      'CONSENT_MISSING',
      expect.stringContaining('consent'),
    );
    expect(deps.repo.markRunning).not.toHaveBeenCalled();
  });

  it('treats a withdrawn consent artifact as missing', async () => {
    const { processor, deps } = buildProcessor();
    deps.consent.findBySessionId.mockResolvedValue({
      id: randomUUID(),
      withdrawnAt: new Date().toISOString(),
    });

    const error = await internals(processor)
      .process(fakeJob())
      .catch((e: unknown) => e);

    expect((error as AnalysisJobError).errorCode).toBe('CONSENT_MISSING');
    expect(deps.client.analyze).not.toHaveBeenCalled();
  });

  it('falls back to the invite-scoped consent artifact', async () => {
    const { processor, deps } = buildProcessor();
    deps.consent.findByInviteId.mockResolvedValue({ id: randomUUID(), withdrawnAt: null });
    deps.client.analyze.mockResolvedValue({
      status: 'completed',
      schema_version: '1.0.0',
      transcript_text: null,
      features: null,
    });

    const result = await internals(processor).process(fakeJob());

    expect(result.status).toBe('completed');
    expect(deps.client.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ consent_verified: true }),
    );
  });
});

describe('AnalysisProcessor processing', () => {
  it('marks the job completed with result, features, media and metrics', async () => {
    const { processor, deps } = buildProcessor();
    consented(deps);
    const job = fakeJob();
    deps.client.analyze.mockResolvedValue({
      status: 'completed',
      analysis_job_id: job.data.analysisJobId,
      schema_version: '1.0.0',
      result: { object_prefix: 'analysis/s/q', objects: { transcript: 'analysis/s/q/t.json' } },
      transcript_text: null,
      features: { speech: { wpm: 132 } },
      media: { duration_sec: 45 },
      metrics: { duration_ms: 1000 },
    });

    const result = await internals(processor).process(job);

    expect(result).toEqual({ status: 'completed', schemaVersion: '1.0.0' });
    expect(deps.repo.markRunning).toHaveBeenCalledWith(job.data.analysisJobId, expect.anything());
    expect(deps.repo.incrementAttempts).toHaveBeenCalledWith(
      job.data.analysisJobId,
      expect.anything(),
    );
    expect(deps.repo.markCompleted).toHaveBeenCalledWith(
      job.data.analysisJobId,
      {
        result: { object_prefix: 'analysis/s/q', objects: { transcript: 'analysis/s/q/t.json' } },
        features: { speech: { wpm: 132 } },
        media: { duration_sec: 45 },
        metrics: { duration_ms: 1000 },
      },
      '1.0.0',
      expect.anything(),
    );
  });

  it('throws when the optimistic running guard loses the race', async () => {
    const { processor, deps } = buildProcessor();
    consented(deps);
    deps.repo.markRunning.mockResolvedValue(false);

    await expect(internals(processor).process(fakeJob())).rejects.toThrow('not available');
    expect(deps.client.analyze).not.toHaveBeenCalled();
  });

  it('writes the transcript back into session_transcript for video answers', async () => {
    const { processor, deps } = buildProcessor();
    consented(deps);
    const job = fakeJob();
    const transcriptRow = {
      id: randomUUID(),
      sessionId: job.data.sessionId,
      questionId: job.data.questionId,
      answerData: {
        type: 'video_answer',
        videoAnswer: { recordingUri: 'http://x', objectName: job.data.objectName },
      },
    };
    deps.transcript.listBySession.mockResolvedValue([transcriptRow]);
    deps.client.analyze.mockResolvedValue({
      status: 'completed',
      schema_version: '1.0.0',
      transcript_text: 'the candidate said things',
      features: {},
    });

    await internals(processor).process(job);

    expect(deps.transcript.answer).toHaveBeenCalledWith(
      transcriptRow.id,
      'the candidate said things',
      expect.anything(),
      undefined,
      expect.objectContaining({
        videoAnswer: expect.objectContaining({ transcript: 'the candidate said things' }),
      }),
    );
    expect(deps.sessions.appendMediaRef).toHaveBeenCalled();
  });

  it('skips transcript write-back for audio jobs', async () => {
    const { processor, deps } = buildProcessor();
    consented(deps);
    deps.client.analyze.mockResolvedValue({
      status: 'completed',
      schema_version: '1.0.0',
      transcript_text: 'words',
      features: {},
    });

    await internals(processor).process(
      fakeJob({ mediaKind: 'audio', questionId: null, objectName: 'recordings/s/hash.wav' }),
    );

    expect(deps.transcript.answer).not.toHaveBeenCalled();
  });

  it('persists typed error codes in the DLQ after the final attempt', async () => {
    const { processor, deps } = buildProcessor();
    const job = fakeJob();

    await internals(processor).moveToDlq(
      job,
      new AnalysisOrchestratorError(502, 'ANALYSIS_FAILED', 'extractor crashed'),
    );

    expect(deps.repo.upsertDlq).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: `${getAnalysisQueueName()}:${job.id}`,
        analysisJobId: job.data.analysisJobId,
        errorCode: 'ANALYSIS_FAILED',
        errorMessage: 'extractor crashed',
        attempts: 3,
      }),
    );
  });

  it('uses PROCESSING_FAILED for untyped DLQ errors', async () => {
    const { processor, deps } = buildProcessor();

    await internals(processor).moveToDlq(fakeJob(), new Error('boom'));

    expect(deps.repo.upsertDlq).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'PROCESSING_FAILED', errorMessage: 'boom' }),
    );
  });
});
