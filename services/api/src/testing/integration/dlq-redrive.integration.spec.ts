import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, AsyncVideoInterviewCreated } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  extractInviteToken,
  makeTestNamespace,
  postJson,
  signup,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('dlq-redrive.test');

interface OrchestratorStubState {
  analysisRequests: number;
  transcribeRequests: number;
  failAnalysis: boolean;
  failTranscribe: boolean;
}

/**
 * Local stub of the AI orchestrator covering both endpoints the API workers
 * call: POST /analysis/video (JSON) and POST /video/transcribe (form-encoded).
 * `failAnalysis` / `failTranscribe` toggle permanent 502s so jobs exhaust
 * retries into the DLQ; flipping them back makes the next attempt succeed.
 */
async function startOrchestratorStub(): Promise<{
  server: Server;
  url: string;
  state: OrchestratorStubState;
}> {
  const state: OrchestratorStubState = {
    analysisRequests: 0,
    transcribeRequests: 0,
    failAnalysis: false,
    failTranscribe: false,
  };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/analysis/video') {
        state.analysisRequests += 1;
        if (state.failAnalysis) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error_code: 'ANALYSIS_FAILED', error_message: 'stub down' }));
          return;
        }
        const body = JSON.parse(raw) as { analysis_job_id: string; session_id: string };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'completed',
            analysis_job_id: body.analysis_job_id,
            schema_version: '1.0.0',
            result: { object_prefix: 'analysis/stub', objects: {} },
            transcript_text: 'stub transcript after redrive',
            features: { speech: { wpm: { value: 120, valid: true } } },
            media: { duration_sec: 45 },
            metrics: { duration_ms: 900, frames_processed: 200, features_generated: 30 },
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/video/transcribe') {
        state.transcribeRequests += 1;
        if (state.failTranscribe) {
          res.writeHead(502, { 'content-type': 'text/plain' });
          res.end('transcription unavailable');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ transcript: 'stub transcript after redrive' }));
        return;
      }
      res.writeHead(404).end('not found');
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
      'Tell us about a time you recovered a failing project.',
      '1-2 years',
    ],
  );
}

async function createConsentedSession(
  test: TestApp,
  adminToken: string,
  roleId: number,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<{ created: AsyncVideoInterviewCreated; recoveryToken: string }> {
  const createRes = await postJson(
    test.baseUrl,
    '/async-video-interviews',
    { roleId, candidate: { name: 'DLQ Candidate', email }, ...extra },
    bearer(adminToken),
  );
  expect(createRes.status).toBe(201);
  const created = (await createRes.json()) as AsyncVideoInterviewCreated;
  const consentRes = await postJson(
    test.baseUrl,
    `/async-video-interviews/by-token/${created.token}/consent`,
    { name: 'DLQ Candidate', email },
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
): Promise<{ transcriptId: string }> {
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
  return (await res.json()) as { transcriptId: string };
}

async function poll<T>(load: () => Promise<T | undefined>, attempts = 120): Promise<T | undefined> {
  for (let i = 0; i < attempts; i += 1) {
    const value = await load();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

describe.runIf(INTEGRATION_AVAILABLE)('DLQ redrive endpoints', () => {
  let test: TestApp;
  let adminToken: string;
  let stub: Awaited<ReturnType<typeof startOrchestratorStub>>;
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `DLQ Redrive Engineer ${randomUUID().slice(0, 8)}`;
  const previousAnalysisQueue = process.env.ANALYSIS_QUEUE_NAME;
  const previousTranscriptionQueue = process.env.TRANSCRIPTION_QUEUE_NAME;

  beforeAll(async () => {
    stub = await startOrchestratorStub();
    // Per-boot UUID queue isolation so this suite's workers never consume
    // jobs from a running Docker API worker (or vice versa).
    process.env.ANALYSIS_QUEUE_NAME = `analysis-redrive-${randomUUID()}`;
    process.env.TRANSCRIPTION_QUEUE_NAME = `transcription-redrive-${randomUUID()}`;
    process.env.ORCHESTRATOR_URL = stub.url;
    test = await bootApp();
    await ns.purge(test.db);
    const signupResult = await signup(test.baseUrl, ns.email('admin'));
    adminToken = signupResult.token;
    await test.db.query(`UPDATE org SET credits_balance = 1000 WHERE id = $1`, [
      signupResult.org.id,
    ]);
    await seedRoleQuestions(test.db, roleId, roleName);
  });

  afterAll(async () => {
    await test.db.query('DELETE FROM role_based_questions WHERE role_name = $1', [roleName]);
    await ns.purge(test.db);
    await test.app.close();
    await new Promise<void>((resolve, reject) =>
      stub.server.close((err) => (err ? reject(err) : resolve())),
    );
    if (previousAnalysisQueue === undefined) delete process.env.ANALYSIS_QUEUE_NAME;
    else process.env.ANALYSIS_QUEUE_NAME = previousAnalysisQueue;
    if (previousTranscriptionQueue === undefined) delete process.env.TRANSCRIPTION_QUEUE_NAME;
    else process.env.TRANSCRIPTION_QUEUE_NAME = previousTranscriptionQueue;
  });

  it('redrives a DLQ analysis job back to completion (admin endpoint)', async () => {
    stub.state.failAnalysis = true;
    try {
      const email = ns.email('analysis-dlq');
      const { created, recoveryToken } = await createConsentedSession(
        test,
        adminToken,
        roleId,
        email,
      );
      const q1 = created.questions[0]!;
      await uploadFakeVideo(test, created.sessionId, q1.id, recoveryToken);

      const dlqRow = await poll(async () => {
        const rows = await test.db.query(
          `SELECT analysis_job_id, error_code FROM analysis_job_dlq WHERE session_id = $1`,
          [created.sessionId],
        );
        return rows.rows[0] as { analysis_job_id: string; error_code: string } | undefined;
      });
      expect(dlqRow).toBeDefined();
      expect(dlqRow!.error_code).toBe('ANALYSIS_FAILED');
      const analysisJobId = dlqRow!.analysis_job_id;

      // Flip the orchestrator back to healthy, then redrive.
      stub.state.failAnalysis = false;
      const redriveRes = await postJson(
        test.baseUrl,
        `/analysis/dlq/${analysisJobId}/redrive`,
        {},
        bearer(adminToken),
      );
      expect(redriveRes.status).toBe(200);
      const redriven = (await redriveRes.json()) as { id: string; status: string };
      expect(redriven.id).toBe(analysisJobId);
      expect(redriven.status).toBe('pending');

      const completed = await poll(async () => {
        const rows = await test.db.query(
          `SELECT status, error_code, schema_version FROM analysis_job WHERE id = $1`,
          [analysisJobId],
        );
        const row = rows.rows[0] as
          { status: string; error_code: string | null; schema_version: string | null } | undefined;
        return row?.status === 'completed' ? row : undefined;
      });
      expect(completed).toBeDefined();
      expect(completed!.error_code).toBeNull();
      expect(completed!.schema_version).toBe('1.0.0');

      const dlqAfter = await test.db.query(
        `SELECT COUNT(*) AS count FROM analysis_job_dlq WHERE analysis_job_id = $1`,
        [analysisJobId],
      );
      expect(Number((dlqAfter.rows[0] as { count: string }).count)).toBe(0);
    } finally {
      stub.state.failAnalysis = false;
    }
  }, 60_000);

  it('redrives a DLQ transcription job back to completion (admin endpoint)', async () => {
    stub.state.failTranscribe = true;
    try {
      const email = ns.email('transcription-dlq');
      const { created, recoveryToken } = await createConsentedSession(
        test,
        adminToken,
        roleId,
        email,
        // Pin the legacy transcription path so this suite exercises the
        // transcription_job DLQ (the analysis DLQ has its own test above).
        { enableTranscription: true, enableAnalysis: false },
      );
      const q1 = created.questions[0]!;
      const upload = await uploadFakeVideo(test, created.sessionId, q1.id, recoveryToken);

      const dlqRow = await poll(async () => {
        const rows = await test.db.query(
          `SELECT job_id, error_message FROM transcription_job_dlq WHERE transcript_id = $1`,
          [upload.transcriptId],
        );
        return rows.rows[0] as { job_id: string; error_message: string } | undefined;
      });
      expect(dlqRow).toBeDefined();
      expect(dlqRow!.job_id).toBeTruthy();

      stub.state.failTranscribe = false;
      const redriveRes = await postJson(
        test.baseUrl,
        `/async-video-interviews/dlq/${upload.transcriptId}/redrive`,
        {},
        bearer(adminToken),
      );
      expect(redriveRes.status).toBe(200);
      const redriven = (await redriveRes.json()) as {
        transcriptId: string;
        sessionId: string;
        requeued: boolean;
      };
      expect(redriven.transcriptId).toBe(upload.transcriptId);
      expect(redriven.sessionId).toBe(created.sessionId);
      expect(redriven.requeued).toBe(true);

      const completed = await poll(async () => {
        const rows = await test.db.query(
          `SELECT status, result FROM transcription_job WHERE transcript_id = $1`,
          [upload.transcriptId],
        );
        const row = rows.rows[0] as { status: string; result: string | null } | undefined;
        return row?.status === 'completed' ? row : undefined;
      });
      expect(completed).toBeDefined();
      expect(completed!.result).toBe('stub transcript after redrive');

      const dlqAfter = await test.db.query(
        `SELECT COUNT(*) AS count FROM transcription_job_dlq WHERE transcript_id = $1`,
        [upload.transcriptId],
      );
      expect(Number((dlqAfter.rows[0] as { count: string }).count)).toBe(0);
    } finally {
      stub.state.failTranscribe = false;
    }
  }, 60_000);

  it('answers 404 for unknown DLQ ids and 403 for non-admin roles', async () => {
    const unknownAnalysis = await postJson(
      test.baseUrl,
      `/analysis/dlq/${randomUUID()}/redrive`,
      {},
      bearer(adminToken),
    );
    expect(unknownAnalysis.status).toBe(404);
    expect(((await unknownAnalysis.json()) as ApiError).code).toBe('DLQ_JOB_NOT_FOUND');

    const unknownTranscription = await postJson(
      test.baseUrl,
      `/async-video-interviews/dlq/${randomUUID()}/redrive`,
      {},
      bearer(adminToken),
    );
    expect(unknownTranscription.status).toBe(404);
    expect(((await unknownTranscription.json()) as ApiError).code).toBe('DLQ_JOB_NOT_FOUND');

    // An interviewer in the admin's org is authenticated but not authorized.
    const teammateEmail = ns.email('teammate');
    const inviteRes = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email: teammateEmail, role: 'interviewer' },
      bearer(adminToken),
    );
    expect(inviteRes.status).toBe(201);
    const mail = await waitForEmail(teammateEmail, 'invited you to InterviewOS');
    const rawToken = extractInviteToken(mail.text);
    const teammate = await signup(test.baseUrl, teammateEmail);
    const acceptRes = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: rawToken },
      bearer(teammate.token),
    );
    expect(acceptRes.status).toBe(200);

    const forbidden = await postJson(
      test.baseUrl,
      `/analysis/dlq/${randomUUID()}/redrive`,
      {},
      bearer(teammate.token),
    );
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as ApiError).code).toBe('FORBIDDEN_ROLE');

    const forbiddenTranscription = await postJson(
      test.baseUrl,
      `/async-video-interviews/dlq/${randomUUID()}/redrive`,
      {},
      bearer(teammate.token),
    );
    expect(forbiddenTranscription.status).toBe(403);
    expect(((await forbiddenTranscription.json()) as ApiError).code).toBe('FORBIDDEN_ROLE');
  }, 60_000);
});
