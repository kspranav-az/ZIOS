import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '@/common/errors';
import type { Queryable } from '@/modules/database';
import type { InvitesRepository } from '@/modules/invites';
import type { SessionsRepository } from '@/modules/sessions';
import type { AnalysisQueue } from './analysis.queue';
import type { AnalysisJobRecord, AnalysisRepository } from './analysis.repository';
import { AnalysisService } from './analysis.service';

function fakeJob(overrides: Partial<AnalysisJobRecord> = {}): AnalysisJobRecord {
  return {
    id: randomUUID(),
    kind: 'multimodal_feature_extraction',
    status: 'pending',
    sessionId: randomUUID(),
    questionId: randomUUID(),
    inviteId: randomUUID(),
    payload: {
      objectName: 'async-video/s/q/hash.webm',
      mediaKind: 'video',
      includeTranscript: true,
      languageHint: null,
    },
    result: null,
    schemaVersion: null,
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function buildService(options: { session?: unknown; invite?: unknown } = {}) {
  const repo = {
    insertPending: vi.fn(async (_input: unknown, _q: unknown) => fakeJob()),
    findBySession: vi.fn(async () => [] as AnalysisJobRecord[]),
    findBySessionAndObject: vi.fn(async () => null as AnalysisJobRecord | null),
  };
  const queue = { add: vi.fn(async () => ({})) };
  const sessions = {
    findById: vi.fn(async () =>
      options.session === undefined
        ? { id: randomUUID(), inviteId: randomUUID() }
        : options.session,
    ),
  };
  const invites = {
    findById: vi.fn(async () =>
      options.invite === undefined ? { id: randomUUID() } : options.invite,
    ),
  };
  const service = new AnalysisService(
    {} as unknown as import('@/modules/database').DatabaseService,
    repo as unknown as AnalysisRepository,
    queue as unknown as AnalysisQueue,
    sessions as unknown as SessionsRepository,
    invites as unknown as InvitesRepository,
  );
  return { service, repo, queue, sessions, invites };
}

const q = {} as Queryable;

describe('AnalysisService enqueue', () => {
  it('creates a pending multimodal job row with the full request in payload', async () => {
    const { service, repo } = buildService();
    const input = {
      sessionId: randomUUID(),
      questionId: randomUUID(),
      inviteId: randomUUID(),
      objectName: 'async-video/s/q/hash.webm',
      mediaKind: 'video' as const,
      includeTranscript: true,
    };

    const job = await service.enqueueMultimodalAnalysis(input, q);

    expect(repo.insertPending).toHaveBeenCalledWith(
      {
        kind: 'multimodal_feature_extraction',
        sessionId: input.sessionId,
        questionId: input.questionId,
        inviteId: input.inviteId,
        payload: {
          objectName: input.objectName,
          mediaKind: 'video',
          includeTranscript: true,
          languageHint: null,
        },
      },
      q,
    );
    expect(job.status).toBe('pending');
  });

  it('enqueueAfterCommit derives the BullMQ job data from the stored row', async () => {
    const { service, queue } = buildService();
    const job = fakeJob();

    await service.enqueueAfterCommit(job);

    expect(queue.add).toHaveBeenCalledWith({
      analysisJobId: job.id,
      kind: job.kind,
      sessionId: job.sessionId,
      questionId: job.questionId,
      inviteId: job.inviteId,
      objectName: 'async-video/s/q/hash.webm',
      mediaKind: 'video',
      includeTranscript: true,
      languageHint: undefined,
    });
  });

  it('enqueueRecordingAnalysis dedupes by object name', async () => {
    const { service, repo } = buildService();
    const input = {
      sessionId: randomUUID(),
      inviteId: randomUUID(),
      objectName: 'recordings/s/hash.wav',
      mediaKind: 'audio' as const,
      includeTranscript: true,
    };

    repo.findBySessionAndObject.mockResolvedValueOnce(fakeJob());
    await expect(service.enqueueRecordingAnalysis(input, q)).resolves.toBeNull();
    expect(repo.insertPending).not.toHaveBeenCalled();

    repo.findBySessionAndObject.mockResolvedValueOnce(null);
    await expect(service.enqueueRecordingAnalysis(input, q)).resolves.not.toBeNull();
    expect(repo.insertPending).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: null }),
      q,
    );
  });
});

describe('AnalysisService reads', () => {
  it('getQuestionFeatures returns the Level-3 features of the latest completed job', async () => {
    const { service, repo } = buildService();
    const sessionId = randomUUID();
    const questionId = randomUUID();
    const completedJob = fakeJob({
      sessionId,
      questionId,
      status: 'completed',
      schemaVersion: '1.0.0',
      completedAt: new Date().toISOString(),
      result: { features: { speech: { wpm: 132 } }, media: { duration_sec: 45 } },
    });
    repo.findBySession.mockResolvedValue([
      fakeJob({ sessionId, questionId, status: 'failed' }),
      completedJob,
      fakeJob({
        sessionId,
        questionId: randomUUID(),
        status: 'completed',
        result: { features: {} },
      }),
    ]);

    const result = await service.getQuestionFeatures(randomUUID(), sessionId, questionId);

    expect(result.analysisJobId).toBe(completedJob.id);
    expect(result.features).toEqual({ speech: { wpm: 132 } });
    expect(result.schemaVersion).toBe('1.0.0');
  });

  it('getQuestionFeatures throws ANALYSIS_NOT_FOUND when no completed job has features', async () => {
    const { service, repo } = buildService();
    repo.findBySession.mockResolvedValue([fakeJob({ status: 'pending' })]);

    const error = await service
      .getQuestionFeatures(randomUUID(), randomUUID(), randomUUID())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(404);
  });

  it('scopes reads to the caller org (404 when the invite belongs elsewhere)', async () => {
    const { service } = buildService({ invite: null });

    const error = await service
      .getSessionAnalysis(randomUUID(), randomUUID())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(404);
  });
});
