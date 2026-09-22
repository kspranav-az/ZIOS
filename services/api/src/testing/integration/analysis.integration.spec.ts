import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AsyncVideoInterviewCreated } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  postJson,
  signup,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('analysis.test');

interface AnalysisRequestLog {
  analysis_job_id: string;
  session_id: string;
  question_id: string | null;
  object_name: string;
  media_kind: string;
  include_transcript: boolean;
  consent_verified: boolean;
}

/**
 * Starts a local stub of the orchestrator's POST /analysis/video endpoint.
 * `failWith` switches it to a permanent 502 for the DLQ test.
 */
async function startOrchestratorStub(): Promise<{
  server: Server;
  url: string;
  state: {
    requests: AnalysisRequestLog[];
    failWith: { status: number; errorCode: string; errorMessage: string } | null;
  };
}> {
  const state = {
    requests: [] as AnalysisRequestLog[],
    failWith: null as { status: number; errorCode: string; errorMessage: string } | null,
  };
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/analysis/video') {
      res.writeHead(404).end('not found');
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as AnalysisRequestLog;
      state.requests.push(body);
      if (state.failWith) {
        res.writeHead(state.failWith.status, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error_code: state.failWith.errorCode,
            error_message: state.failWith.errorMessage,
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'completed',
          analysis_job_id: body.analysis_job_id,
          schema_version: '1.0.0',
          result: {
            object_prefix: `analysis/${body.session_id}/${body.question_id ?? 'session'}`,
            objects: { aggregated_features: 'analysis/s/q/aggregated_features.json' },
          },
          transcript_text: 'stub transcript from the analysis pipeline',
          features: { speech: { wpm: { value: 132, valid: true } } },
          media: { duration_sec: 45, fps: 5, width: 854, height: 480, audio_sample_rate: 16000 },
          metrics: { duration_ms: 1200, frames_processed: 225, features_generated: 40 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}`, state };
}

async function seedRoleQuestions(db: TestApp['db'], roleId: number, roleName: string) {
  await db.query(
    `INSERT INTO role_based_questions
     (id, role_id, role_name, question_number, difficulty_level, question_type, question_text, experience_target)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      roleId,
      roleName,
      1,
      'medium',
      'Project-Based Experience Validation',
      'Tell us about a time you led a project under pressure.',
      '1-2 years',
    ],
  );
}

async function createConsentedLiveSession(
  test: TestApp,
  adminToken: string,
  roleId: number,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ created: AsyncVideoInterviewCreated; recoveryToken: string }> {
  const createRes = await postJson(
    test.baseUrl,
    '/async-video-interviews',
    {
      roleId,
      candidate: { name: 'Analysis Candidate', email },
      enableTranscription: true,
      ...extra,
    },
    bearer(adminToken),
  );
  expect(createRes.status).toBe(201);
  const created = (await createRes.json()) as AsyncVideoInterviewCreated;

  const consentRes = await postJson(
    test.baseUrl,
    `/async-video-interviews/by-token/${created.token}/consent`,
    { name: 'Analysis Candidate', email },
  );
  expect(consentRes.status).toBe(200);
  const consentBody = (await consentRes.json()) as { recoveryToken: string };
  return { created, recoveryToken: consentBody.recoveryToken };
}

async function uploadFakeVideo(
  test: TestApp,
  sessionId: string,
  questionId: string,
  recoveryToken: string,
): Promise<void> {
  const bytes = Buffer.from('fake-video-webm-bytes');
  const form = new FormData();
  form.append('video', new Blob([bytes], { type: 'video/webm' }), 'answer.webm');
  form.append('durationSec', '45');
  const res = await fetch(
    `${test.baseUrl}/async-video-interviews/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/video`,
    { method: 'POST', headers: { 'x-recovery-token': recoveryToken }, body: form },
  );
  if (res.status !== 200) {
    console.error('upload failed:', res.status, await res.text());
  }
  expect(res.status).toBe(200);
}

async function poll<T>(load: () => Promise<T | undefined>, attempts = 120): Promise<T | undefined> {
  for (let i = 0; i < attempts; i += 1) {
    const value = await load();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

describe.runIf(INTEGRATION_AVAILABLE)('Multimodal analysis pipeline', () => {
  let test: TestApp;
  let adminToken: string;
  let adminOrgId: string;
  let stub: Awaited<ReturnType<typeof startOrchestratorStub>>;
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `Analysis Test Engineer ${randomUUID().slice(0, 8)}`;
  const queueName = `analysis-test-${randomUUID()}`;
  const previousQueueName = process.env.ANALYSIS_QUEUE_NAME;
  const previousOrchestrator = process.env.ORCHESTRATOR_URL;

  beforeAll(async () => {
    stub = await startOrchestratorStub();
    process.env.ANALYSIS_QUEUE_NAME = queueName;
    process.env.ORCHESTRATOR_URL = stub.url;
    test = await bootApp();
    const signupResult = await signup(test.baseUrl, ns.email('admin'));
    adminToken = signupResult.token;
    adminOrgId = signupResult.org.id;
    await test.db.query(
      `UPDATE credit_account SET balance = 1000 WHERE holder_type = 'org' AND holder_id = $1`,
      [adminOrgId],
    );
    await test.db.query(`UPDATE org SET credits_balance = 1000 WHERE id = $1`, [adminOrgId]);
    await seedRoleQuestions(test.db, roleId, roleName);
  });

  afterAll(async () => {
    await test.db.query('DELETE FROM role_based_questions WHERE role_name = $1', [roleName]);
    await test.app.close();
    await new Promise<void>((resolve, reject) =>
      stub.server.close((err) => (err ? reject(err) : resolve())),
    );
    if (previousQueueName === undefined) {
      delete process.env.ANALYSIS_QUEUE_NAME;
    } else {
      process.env.ANALYSIS_QUEUE_NAME = previousQueueName;
    }
    if (previousOrchestrator === undefined) {
      delete process.env.ORCHESTRATOR_URL;
    } else {
      process.env.ORCHESTRATOR_URL = previousOrchestrator;
    }
  });

  it('runs upload → analysis → transcript write-back and serves the read endpoints', async () => {
    const email = ns.email('candidate');
    const { created, recoveryToken } = await createConsentedLiveSession(
      test,
      adminToken,
      roleId,
      email,
    );
    const q1 = created.questions[0]!;
    await uploadFakeVideo(test, created.sessionId, q1.id, recoveryToken);

    interface JobRow {
      id: string;
      status: string;
      kind: string;
      schema_version: string | null;
      result: { features?: unknown; media?: unknown } | null;
      error_code: string | null;
    }
    const job = await poll(async () => {
      const rows = await test.db.query(
        `SELECT id, status, kind, schema_version, result, error_code
         FROM analysis_job WHERE session_id = $1 AND question_id = $2`,
        [created.sessionId, q1.id],
      );
      const row = rows.rows[0] as JobRow | undefined;
      return row?.status === 'completed' ? row : undefined;
    });
    expect(job).toBeDefined();
    expect(job!.kind).toBe('multimodal_feature_extraction');
    expect(job!.schema_version).toBe('1.0.0');
    expect(job!.error_code).toBeNull();
    expect(job!.result?.features).toEqual({ speech: { wpm: { value: 132, valid: true } } });

    // The legacy transcription path must not have been used.
    const legacyRows = await test.db.query(
      `SELECT COUNT(*) AS count FROM transcription_job t
       JOIN session_transcript st ON st.id = t.transcript_id
       WHERE st.session_id = $1`,
      [created.sessionId],
    );
    expect(Number((legacyRows.rows[0] as { count: string }).count)).toBe(0);

    // The orchestrator received the contract payload with verified consent.
    const request = stub.state.requests.find((r) => r.analysis_job_id === job!.id);
    expect(request).toBeDefined();
    expect(request!.media_kind).toBe('video');
    expect(request!.include_transcript).toBe(true);
    expect(request!.consent_verified).toBe(true);
    expect(request!.object_name).toContain(`async-video/${created.sessionId}/${q1.id}/`);

    // Transcript written back to session_transcript so the review page works.
    const transcriptRow = await test.db.query(
      `SELECT answer_text, answer_data -> 'videoAnswer' ->> 'transcript' AS data_transcript
       FROM session_transcript WHERE session_id = $1 AND question_id = $2`,
      [created.sessionId, q1.id],
    );
    expect(transcriptRow.rows[0]?.answer_text).toBe('stub transcript from the analysis pipeline');
    expect(transcriptRow.rows[0]?.data_transcript).toBe(
      'stub transcript from the analysis pipeline',
    );

    // Employer read endpoints.
    const listRes = await fetch(`${test.baseUrl}/analysis/sessions/${created.sessionId}`, {
      headers: bearer(adminToken),
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      sessionId: string;
      jobs: Array<{ id: string; status: string; schemaVersion: string | null }>;
    };
    expect(list.jobs).toHaveLength(1);
    expect(list.jobs[0]?.status).toBe('completed');
    expect(list.jobs[0]?.schemaVersion).toBe('1.0.0');

    const featuresRes = await fetch(
      `${test.baseUrl}/analysis/sessions/${created.sessionId}/questions/${q1.id}/features`,
      { headers: bearer(adminToken) },
    );
    expect(featuresRes.status).toBe(200);
    const features = (await featuresRes.json()) as { features: unknown; schemaVersion: string };
    expect(features.features).toEqual({ speech: { wpm: { value: 132, valid: true } } });

    // Tenant scoping: a user from another org cannot read the analysis.
    const other = await signup(test.baseUrl, ns.email('other-org-admin'));
    const forbidden = await fetch(`${test.baseUrl}/analysis/sessions/${created.sessionId}`, {
      headers: bearer(other.token),
    });
    expect(forbidden.status).toBe(404);
  });

  it('moves a permanently failing analysis job to the DLQ with typed errors', async () => {
    stub.state.failWith = {
      status: 502,
      errorCode: 'ANALYSIS_FAILED',
      errorMessage: 'extractor crashed',
    };
    try {
      const email = ns.email('dlq-candidate');
      const { created, recoveryToken } = await createConsentedLiveSession(
        test,
        adminToken,
        roleId,
        email,
      );
      const q1 = created.questions[0]!;
      await uploadFakeVideo(test, created.sessionId, q1.id, recoveryToken);

      const dlqRow = await poll(async () => {
        const rows = await test.db.query(
          `SELECT job_id, error_code, error_message, attempts FROM analysis_job_dlq
           WHERE session_id = $1`,
          [created.sessionId],
        );
        return rows.rows[0] as
          | { job_id: string; error_code: string; error_message: string; attempts: number }
          | undefined;
      });
      expect(dlqRow).toBeDefined();
      expect(dlqRow!.job_id).toBeTruthy();
      expect(dlqRow!.error_code).toBe('ANALYSIS_FAILED');
      expect(dlqRow!.error_message).toBe('extractor crashed');
      expect(dlqRow!.attempts).toBeGreaterThanOrEqual(3);

      const jobRows = await test.db.query(
        `SELECT status, error_code FROM analysis_job WHERE session_id = $1`,
        [created.sessionId],
      );
      expect(jobRows.rows[0]?.status).toBe('failed');
      expect(jobRows.rows[0]?.error_code).toBe('ANALYSIS_FAILED');
    } finally {
      stub.state.failWith = null;
    }
  }, 60_000);

  it('refuses analysis without a consent artifact (CONSENT_MISSING, no orchestrator call)', async () => {
    // Create an interview but never consent: the session stays 'invited' and
    // no consent_record exists. Seed the job row directly and enqueue it.
    const email = ns.email('no-consent-candidate');
    const createRes = await postJson(
      test.baseUrl,
      '/async-video-interviews',
      { roleId, candidate: { name: 'No Consent', email }, enableTranscription: true },
      bearer(adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as AsyncVideoInterviewCreated;

    const analysisJobId = randomUUID();
    await test.db.query(
      `INSERT INTO analysis_job (id, kind, session_id, question_id, invite_id, payload)
       VALUES ($1, 'multimodal_feature_extraction', $2, $3, $4, $5::jsonb)`,
      [
        analysisJobId,
        created.sessionId,
        created.questions[0]!.id,
        created.inviteId,
        JSON.stringify({
          objectName: `async-video/${created.sessionId}/${created.questions[0]!.id}/fake.webm`,
          mediaKind: 'video',
          includeTranscript: true,
        }),
      ],
    );

    const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue(queueName, { connection: redis });
    const requestCountBefore = stub.state.requests.length;
    try {
      await queue.add('analyze', {
        analysisJobId,
        kind: 'multimodal_feature_extraction',
        sessionId: created.sessionId,
        questionId: created.questions[0]!.id,
        inviteId: created.inviteId,
        objectName: `async-video/${created.sessionId}/${created.questions[0]!.id}/fake.webm`,
        mediaKind: 'video',
        includeTranscript: true,
      });

      const failedJob = await poll(async () => {
        const rows = await test.db.query(
          `SELECT status, error_code FROM analysis_job WHERE id = $1`,
          [analysisJobId],
        );
        const row = rows.rows[0] as { status: string; error_code: string | null } | undefined;
        return row?.status === 'failed' ? row : undefined;
      });
      expect(failedJob).toBeDefined();
      expect(failedJob!.error_code).toBe('CONSENT_MISSING');
      // The orchestrator was never called for this job.
      expect(stub.state.requests.filter((r) => r.analysis_job_id === analysisJobId)).toHaveLength(
        0,
      );
      expect(stub.state.requests.length).toBe(requestCountBefore);

      // Retries exhaust into the DLQ with the typed error.
      const dlqRow = await poll(async () => {
        const rows = await test.db.query(
          `SELECT error_code FROM analysis_job_dlq WHERE analysis_job_id = $1`,
          [analysisJobId],
        );
        return rows.rows[0] as { error_code: string } | undefined;
      });
      expect(dlqRow?.error_code).toBe('CONSENT_MISSING');
    } finally {
      await queue.close();
      await redis.quit();
    }
  }, 60_000);
});
