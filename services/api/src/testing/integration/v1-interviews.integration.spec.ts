import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ApiError,
  ConsentByTokenResponse,
  CreateQuestionBody,
  KitDetailResponse,
  KitVersion,
  PreflightResponse,
  ReportDetailResponse,
  TurnResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  postJson,
  signup,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('v1-interviews.test');

interface V1Created {
  interview_id: string;
  invite_link: string | null;
  status: string;
  idempotent_replay: boolean;
}

interface V1Status {
  id: string;
  status: string;
  mode: string;
  candidate: { external_ref: string };
  created_at: string;
  completed_at: string | null;
}

const JD_TEXT = `Senior Backend Engineer — we are hiring a senior backend engineer
to design and operate distributed services at scale. You will own API design,
Postgres data modeling, queue-based workers, and observability. Requirements:
5+ years with TypeScript or Python, strong SQL, experience with event-driven
architectures, Redis, Docker, and CI/CD. You will mentor juniors, run
incident reviews, and drive reliability work (SLOs, alerting). Nice to have:
Kubernetes, gRPC, and payments-domain experience.`;

async function createPublishedKit(
  test: TestApp,
  token: string,
  settings?: Record<string, unknown>,
): Promise<{ kit: KitDetailResponse['kit']; version: KitVersion }> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'V1 Kit', role: 'Engineer', level: 'Mid', ...(settings ? { settings } : {}) },
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const q1: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'Tell us about a challenging project.',
    topic: 'Experience',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: randomUUID(), text: 'Clarity', weight: 1 }],
  };
  const add = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, q1, bearer(token));
  expect(add.status).toBe(201);

  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  const version = (
    (await publish.json()) as { version: { id: string; kitId: string; version: number } }
  ).version;
  const getVersion = await fetch(`${test.baseUrl}/kits/${kit.id}/versions/${version.version}`, {
    headers: bearer(token),
  });
  expect(getVersion.status).toBe(200);
  return { kit, version: ((await getVersion.json()) as { version: KitVersion }).version };
}

async function makeApiKey(
  test: TestApp,
  adminToken: string,
  scopes?: string[],
): Promise<string> {
  const res = await postJson(
    test.baseUrl,
    '/integration-api/keys',
    { kind: 'test', ...(scopes ? { scopes } : {}) },
    bearer(adminToken),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

function v1Auth(rawKey: string): Record<string, string> {
  return { authorization: `Bearer ${rawKey}` };
}

async function v1Create(
  test: TestApp,
  rawKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return postJson(test.baseUrl, '/v1/interviews', body, v1Auth(rawKey));
}

/** Drives a v1-created text interview to completion via the candidate API. */
async function completeInterviewFromLink(
  test: TestApp,
  inviteLink: string,
): Promise<{ sessionId: string; recoveryToken: string }> {
  const token = new URL(inviteLink).searchParams.get('token');
  expect(token).toBeTruthy();

  // The invite link must resolve on the public candidate surface.
  const resolve = await fetch(`${test.baseUrl}/invites/by-token/${encodeURIComponent(token!)}`);
  expect(resolve.status).toBe(200);

  const consentRes = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {
    name: 'V1 Candidate',
  });
  expect(consentRes.status).toBe(200);
  const consentBody = (await consentRes.json()) as ConsentByTokenResponse;
  const { session, recoveryToken } = consentBody;

  const preflight = await postJson(
    test.baseUrl,
    `/sessions/${session.id}/preflight`,
    {},
    { 'x-recovery-token': recoveryToken },
  );
  expect(preflight.status).toBe(200);
  const preflightBody = (await preflight.json()) as PreflightResponse;
  expect(preflightBody.session.status).toBe('live');

  let turn = preflightBody.turn;
  const answers = [
    'A long and detailed answer that explains the project thoroughly with concrete outcomes and metrics.',
    'I prioritize by impact, communicate early, and break the work into small milestones with owners.',
  ];
  let i = 0;
  while (turn.type !== 'wrapup') {
    const turnRes = await postJson(
      test.baseUrl,
      `/sessions/${session.id}/turn`,
      { answer: answers[i % answers.length] },
      { 'x-recovery-token': recoveryToken },
    );
    expect(turnRes.status).toBe(200);
    turn = ((await turnRes.json()) as TurnResponse).turn;
    i += 1;
    expect(i).toBeLessThan(12);
  }
  return { sessionId: session.id, recoveryToken };
}

async function pollForReport(
  test: TestApp,
  adminToken: string,
  sessionId: string,
): Promise<ReportDetailResponse> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${test.baseUrl}/reports/${sessionId}`, {
      headers: bearer(adminToken),
    });
    if (res.status === 200) {
      const body = (await res.json()) as ReportDetailResponse;
      if (body.report.status === 'completed') return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('report did not complete in time');
}

describe.runIf(INTEGRATION_AVAILABLE)('v1 partner interviews API', () => {
  let test: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
    const account = await signup(test.baseUrl, ns.email('admin'));
    adminToken = account.token;
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('creates an interview from kit_id; link resolves; status polls', async () => {
    const rawKey = await makeApiKey(test, adminToken);
    const { version } = await createPublishedKit(test, adminToken);

    const createRes = await v1Create(test, rawKey, {
      kit_id: version.kitId,
      mode: 'text',
      candidate: {
        name: 'Partner Candidate',
        email: ns.email('kit-candidate'),
        external_ref: 'cand-1001',
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as V1Created;
    expect(created.interview_id).toBeTruthy();
    expect(created.idempotent_replay).toBe(false);
    expect(created.invite_link).toContain('/?token=');

    const statusRes = await fetch(
      `${test.baseUrl}/v1/interviews/${created.interview_id}`,
      { headers: v1Auth(rawKey) },
    );
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as V1Status;
    expect(status.status).toBe('invited');
    expect(status.mode).toBe('text');
    expect(status.candidate.external_ref).toBe('cand-1001');
    expect(status.completed_at).toBeNull();
  }, 30_000);

  it('creates an interview from jd_text (kit generated with requested mode)', async () => {
    const rawKey = await makeApiKey(test, adminToken);

    const createRes = await v1Create(test, rawKey, {
      jd_text: JD_TEXT,
      mode: 'text',
      proctoring_level: 'standard',
      candidate: {
        name: 'JD Candidate',
        email: ns.email('jd-candidate'),
        external_ref: 'cand-2002',
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as V1Created;
    expect(created.interview_id).toBeTruthy();

    const status = (await (
      await fetch(`${test.baseUrl}/v1/interviews/${created.interview_id}`, {
        headers: v1Auth(rawKey),
      })
    ).json()) as V1Status;
    expect(status.status).toBe('invited');
  }, 30_000);

  it('retries are idempotent: same external_ref returns the original interview', async () => {
    const rawKey = await makeApiKey(test, adminToken);
    const { version } = await createPublishedKit(test, adminToken);
    const body = {
      kit_id: version.kitId,
      mode: 'text',
      candidate: {
        name: 'Retry Candidate',
        email: ns.email('retry-candidate'),
        external_ref: 'cand-3003',
      },
    };

    const first = (await (await v1Create(test, rawKey, body)).json()) as V1Created;
    expect(first.idempotent_replay).toBe(false);
    expect(first.invite_link).toBeTruthy();

    const retryRes = await v1Create(test, rawKey, body);
    expect(retryRes.status).toBe(201);
    const retry = (await retryRes.json()) as V1Created;
    expect(retry.interview_id).toBe(first.interview_id);
    expect(retry.idempotent_replay).toBe(true);
    expect(retry.invite_link).toBeNull();

    const rows = await test.db.query(
      `SELECT COUNT(*) AS count FROM external_interview
       WHERE org_id = (SELECT org_id FROM api_key WHERE key_hash = encode(sha256($1::bytea), 'hex'))`,
      [Buffer.from(rawKey, 'utf8')],
    );
    expect(Number((rows.rows[0] as { count: string }).count)).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('enforces authn/authz: 401 without key, 403 without interviews:write scope, cross-org 404', async () => {
    const rawKey = await makeApiKey(test, adminToken);
    const readOnlyKey = await makeApiKey(test, adminToken, ['interviews:read']);
    const { version } = await createPublishedKit(test, adminToken);
    const body = {
      kit_id: version.kitId,
      mode: 'text',
      candidate: { name: 'Sec Candidate', email: ns.email('sec-candidate'), external_ref: 'x-1' },
    };

    const unauthenticated = await postJson(test.baseUrl, '/v1/interviews', body);
    expect(unauthenticated.status).toBe(401);

    const wrongShape = await postJson(test.baseUrl, '/v1/interviews', body, {
      authorization: 'Bearer session-token',
    });
    expect(wrongShape.status).toBe(401);

    const readOnly = await v1Create(test, readOnlyKey, body);
    expect(readOnly.status).toBe(403);
    expect(((await readOnly.json()) as ApiError).code).toBe('FORBIDDEN_SCOPE');

    const created = (await (await v1Create(test, rawKey, body)).json()) as V1Created;
    const outsiderKey = await makeApiKey(
      test,
      (await signup(test.baseUrl, ns.email('outsider'))).token,
    );
    const crossOrg = await fetch(`${test.baseUrl}/v1/interviews/${created.interview_id}`, {
      headers: v1Auth(outsiderKey),
    });
    expect(crossOrg.status).toBe(404);
  }, 30_000);

  it('validates mode: mismatch with kit and unsupported async_video', async () => {
    const rawKey = await makeApiKey(test, adminToken);
    const { version } = await createPublishedKit(test, adminToken, { mode: 'video' });

    const mismatch = await v1Create(test, rawKey, {
      kit_id: version.kitId,
      mode: 'text',
      candidate: { name: 'M', email: ns.email('m1'), external_ref: 'm-1' },
    });
    expect(mismatch.status).toBe(422);
    expect(((await mismatch.json()) as ApiError).code).toBe('MODE_MISMATCH');

    const video = await v1Create(test, rawKey, {
      kit_id: version.kitId,
      mode: 'video',
      candidate: { name: 'V', email: ns.email('v1'), external_ref: 'v-1' },
    });
    expect(video.status).toBe(201);

    const asyncVideo = await v1Create(test, rawKey, {
      jd_text: JD_TEXT,
      mode: 'async_video',
      candidate: { name: 'A', email: ns.email('a1'), external_ref: 'a-1' },
    });
    expect(asyncVideo.status).toBe(422);
    expect(((await asyncVideo.json()) as ApiError).code).toBe('MODE_NOT_SUPPORTED');
  }, 30_000);

  it('serves the scorecard from the shared evaluation read path after completion', async () => {
    const rawKey = await makeApiKey(test, adminToken);
    const { version } = await createPublishedKit(test, adminToken);

    const created = (await (
      await v1Create(test, rawKey, {
        kit_id: version.kitId,
        mode: 'text',
        candidate: {
          name: 'Score Candidate',
          email: ns.email('score-candidate'),
          external_ref: 'cand-4004',
        },
      })
    ).json()) as V1Created;

    // Before the interview starts there is no scorecard.
    const early = await fetch(`${test.baseUrl}/v1/interviews/${created.interview_id}/scorecard`, {
      headers: v1Auth(rawKey),
    });
    expect(early.status).toBe(404);

    const { sessionId } = await completeInterviewFromLink(test, created.invite_link!);
    const report = await pollForReport(test, adminToken, sessionId);

    const scorecardRes = await fetch(
      `${test.baseUrl}/v1/interviews/${created.interview_id}/scorecard`,
      { headers: v1Auth(rawKey) },
    );
    expect(scorecardRes.status).toBe(200);
    const scorecard = (await scorecardRes.json()) as {
      schema_version: string;
      interview_id: string;
      candidate: { external_ref: string };
      scores: Array<{ criterion: string }>;
      evidence_spans: unknown[];
      recommendation: string | null;
    };
    expect(scorecard.schema_version).toBe('v1');
    expect(scorecard.interview_id).toBe(created.interview_id);
    expect(scorecard.candidate.external_ref).toBe('cand-4004');
    expect(scorecard.scores.length).toBe(report.scores.length);
    expect(scorecard.scores.length).toBeGreaterThan(0);
    expect(scorecard.evidence_spans.length).toBe(report.evidenceSpans.length);
  }, 60_000);
});
