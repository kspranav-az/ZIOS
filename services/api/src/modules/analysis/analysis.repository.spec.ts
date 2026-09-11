import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService, Queryable } from '@/modules/database';
import { AnalysisRepository, type AnalysisJobRecord } from './analysis.repository';

function fakeQueryable(rows: unknown[] = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    kind: 'multimodal_feature_extraction',
    status: 'pending',
    session_id: randomUUID(),
    question_id: randomUUID(),
    invite_id: randomUUID(),
    payload: {
      objectName: 'async-video/s/q/hash.webm',
      mediaKind: 'video',
      includeTranscript: true,
    },
    result: null,
    schema_version: null,
    attempts: 0,
    error_code: null,
    error_message: null,
    created_at: new Date('2026-09-11T00:00:00Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function buildRepo() {
  const db = { query: vi.fn() } as unknown as DatabaseService;
  return { repo: new AnalysisRepository(db), db };
}

describe('AnalysisRepository', () => {
  it('insertPending inserts a pending job and maps the row', async () => {
    const { repo } = buildRepo();
    const row = fakeRow();
    const q = fakeQueryable([row]);

    const job = await repo.insertPending(
      {
        kind: 'multimodal_feature_extraction',
        sessionId: row.session_id as string,
        questionId: row.question_id as string,
        inviteId: row.invite_id as string,
        payload: row.payload as Record<string, unknown>,
      },
      q as unknown as Queryable,
    );

    expect(q.query).toHaveBeenCalledOnce();
    const [sql, params] = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).toContain('INSERT INTO analysis_job');
    expect(params).toEqual([
      'multimodal_feature_extraction',
      row.session_id,
      row.question_id,
      row.invite_id,
      JSON.stringify(row.payload),
    ]);
    expect(job.status).toBe('pending');
    expect(job.sessionId).toBe(row.session_id);
    expect(job.payload).toEqual(row.payload);
  });

  it('markRunning transitions only pending/failed jobs (optimistic guard)', async () => {
    const { repo } = buildRepo();
    const id = randomUUID();

    const ok = fakeQueryable([{ id }], 1);
    await expect(repo.markRunning(id, ok as unknown as Queryable)).resolves.toBe(true);
    const [sql] = (ok.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).toContain("status IN ('pending', 'failed')");

    // Double-run conflict: a second claim finds the row already running.
    const conflict = fakeQueryable([], 0);
    await expect(repo.markRunning(id, conflict as unknown as Queryable)).resolves.toBe(false);
  });

  it('markCompleted stores the result jsonb and schema version', async () => {
    const { repo } = buildRepo();
    const q = fakeQueryable([], 1);
    const id = randomUUID();
    const result = { features: { speech: { wpm: 132 } }, media: { duration_sec: 45 } };

    await repo.markCompleted(id, result, '1.0.0', q as unknown as Queryable);

    const [sql, params] = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).toContain("status = 'completed'");
    expect(params).toEqual([JSON.stringify(result), '1.0.0', id]);
  });

  it('markFailed persists error_code and error_message', async () => {
    const { repo } = buildRepo();
    const q = fakeQueryable([], 1);
    const id = randomUUID();

    await repo.markFailed(id, 'CONSENT_MISSING', 'no consent artifact', q as unknown as Queryable);

    const [sql, params] = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).toContain("status = 'failed'");
    expect(params).toEqual(['CONSENT_MISSING', 'no consent artifact', id]);
  });

  it('incrementAttempts bumps the attempts counter', async () => {
    const { repo } = buildRepo();
    const q = fakeQueryable([], 1);
    const id = randomUUID();

    await repo.incrementAttempts(id, q as unknown as Queryable);

    const [sql, params] = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).toContain('attempts = attempts + 1');
    expect(params).toEqual([id]);
  });

  it('upsertDlq keys the DLQ row by the BullMQ job id', async () => {
    const { repo } = buildRepo();
    const q = fakeQueryable([], 1);
    const input = {
      jobId: 'bullmq-job-1',
      analysisJobId: randomUUID(),
      kind: 'multimodal_feature_extraction' as const,
      sessionId: randomUUID(),
      questionId: null,
      errorCode: 'HTTP_502',
      errorMessage: 'bad gateway',
      attempts: 3,
    };

    await repo.upsertDlq(input, q as unknown as Queryable);

    const [sql, params] = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).toContain('INSERT INTO analysis_job_dlq');
    expect(sql).toContain('ON CONFLICT (job_id)');
    expect(params).toEqual([
      input.jobId,
      input.analysisJobId,
      input.kind,
      input.sessionId,
      null,
      'HTTP_502',
      'bad gateway',
      3,
    ]);
  });

  it('findBySessionAndObject dedupes on the payload object name', async () => {
    const { repo } = buildRepo();
    const sessionId = randomUUID();
    const q = fakeQueryable([fakeRow({ session_id: sessionId })]);

    const found = await repo.findBySessionAndObject(
      sessionId,
      'recordings/s/hash.wav',
      q as unknown as Queryable,
    );

    expect(found).not.toBeNull();
    const [sql, params] = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).toContain("payload ->> 'objectName'");
    expect(params).toEqual([sessionId, 'recordings/s/hash.wav']);
  });

  it('findBySession returns mapped records ordered by creation', async () => {
    const { repo } = buildRepo();
    const sessionId = randomUUID();
    const q = fakeQueryable([
      fakeRow({ session_id: sessionId }),
      fakeRow({ session_id: sessionId }),
    ]);

    const jobs = await repo.findBySession(sessionId, q as unknown as Queryable);

    expect(jobs).toHaveLength(2);
    for (const job of jobs satisfies AnalysisJobRecord[]) {
      expect(job.sessionId).toBe(sessionId);
    }
  });
});
