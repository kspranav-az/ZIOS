import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CandidateAuthResponse,
  CandidateResumeResponse,
  PracticeCreateResponse,
  PracticeSessionDetailResponse,
  ResumeJdMatchResponse,
} from '@zios/shared-types';
import { StorageClient } from '@/modules/storage';
import {
  INTEGRATION_AVAILABLE,
  bootApp,
  extractOtp,
  makeTestNamespace,
  postJson,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('resume-intelligence.test');

const SAMPLE_RESUME = `Priya Sharma
priya.sharma@example.com | +91 98765 43210

Summary: Backend engineer with 6 years of experience building payment systems.

Skills:
- Python
- PostgreSQL
- Kafka
- AWS

Experience:
Senior Backend Engineer, Zylo Payments (2021 - present)
- Led a team of 5 engineers building the reconciliation service
- Cut processing latency by 40 percent through batching and caching
- Migrated 12 services from VMs to Kubernetes

Education:
B.Tech Computer Science, IIT Delhi, 2018
`;

const SAMPLE_JD = `Senior Backend Engineer

We are hiring a Senior Backend Engineer to own our payments platform.

Responsibilities:
- Design and operate high-throughput payment APIs
- Mentor a team of engineers

Required skills:
- Python
- PostgreSQL
- Kubernetes
- AWS
- Kafka

Nice to have:
- Terraform
- Stripe integrations
`;

async function candSignup(
  test: TestApp,
  email: string,
): Promise<{ token: string; accountId: string }> {
  await postJson(test.baseUrl, '/cand/auth/otp/request', { email });
  const mail = await waitForEmail(email, 'Ascend sign-in code');
  const verify = await postJson(test.baseUrl, '/cand/auth/otp/verify', {
    email,
    code: extractOtp(mail.text),
  });
  expect(verify.status).toBe(200);
  const body = (await verify.json()) as CandidateAuthResponse;
  return { token: body.session.token, accountId: body.account.id };
}

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe.runIf(INTEGRATION_AVAILABLE)('resume intelligence (Phase 12, D10)', () => {
  let test: TestApp;
  let storage: StorageClient;

  beforeAll(async () => {
    test = await bootApp();
    storage = new StorageClient();
  }, 120_000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('uploads, parses and ATS-checks a resume via the fixtures', async () => {
    const candidate = await candSignup(test, ns.email('upload'));
    const upload = await postJson(
      test.baseUrl,
      '/cand/resume',
      {
        fileName: 'priya-resume.txt',
        contentBase64: Buffer.from(SAMPLE_RESUME, 'utf8').toString('base64'),
      },
      authed(candidate.token),
    );
    expect(upload.status).toBe(201);
    const resume = (await upload.json()) as CandidateResumeResponse;
    expect(resume.fileName).toBe('priya-resume.txt');
    expect(resume.parsed?.email).toBe('priya.sharma@example.com');
    expect(resume.parsed?.skills).toContain('Python');
    expect(resume.parsed?.experiences[0]?.highlights.length).toBeGreaterThan(0);
    expect(resume.atsReport?.score).toBeGreaterThan(0);
    expect(resume.atsReport?.issues.length).toBeGreaterThan(0);

    const fetched = await fetch(`${test.baseUrl}/cand/resume`, { headers: authed(candidate.token) });
    expect(fetched.status).toBe(200);
  });

  it('re-upload replaces the row and deletes the old MinIO object', async () => {
    const candidate = await candSignup(test, ns.email('replace'));
    const first = await postJson(
      test.baseUrl,
      '/cand/resume',
      { fileName: 'v1.txt', contentBase64: Buffer.from(SAMPLE_RESUME, 'utf8').toString('base64') },
      authed(candidate.token),
    );
    expect(first.status).toBe(201);
    const firstKey = (
      await test.db.query(`SELECT file_key FROM candidate_resume WHERE account_id = $1`, [
        candidate.accountId,
      ])
    ).rows[0] as { file_key: string };

    const second = await postJson(
      test.baseUrl,
      '/cand/resume',
      {
        fileName: 'v2.txt',
        contentBase64: Buffer.from(`${SAMPLE_RESUME}\nCertification: AWS SA Pro\n`, 'utf8').toString(
          'base64',
        ),
      },
      authed(candidate.token),
    );
    expect(second.status).toBe(201);
    const secondRow = (await second.json()) as CandidateResumeResponse;
    expect(secondRow.fileName).toBe('v2.txt');

    const rows = await test.db.query(`SELECT file_key FROM candidate_resume WHERE account_id = $1`, [
      candidate.accountId,
    ]);
    expect(rows.rowCount).toBe(1);
    expect((rows.rows[0] as { file_key: string }).file_key).not.toBe(firstKey.file_key);
    // Old object erased from object storage.
    expect(await storage.objectExists(firstKey.file_key)).toBe(false);
  });

  it('erasure removes the row and the MinIO object', async () => {
    const candidate = await candSignup(test, ns.email('erase'));
    const upload = await postJson(
      test.baseUrl,
      '/cand/resume',
      { fileName: 'temp.txt', contentBase64: Buffer.from(SAMPLE_RESUME, 'utf8').toString('base64') },
      authed(candidate.token),
    );
    expect(upload.status).toBe(201);
    const key = (
      await test.db.query(`SELECT file_key FROM candidate_resume WHERE account_id = $1`, [
        candidate.accountId,
      ])
    ).rows[0] as { file_key: string };

    const del = await fetch(`${test.baseUrl}/cand/resume`, {
      method: 'DELETE',
      headers: authed(candidate.token),
    });
    expect(del.status).toBe(200);
    const getAfter = await fetch(`${test.baseUrl}/cand/resume`, { headers: authed(candidate.token) });
    expect(getAfter.status).toBe(404);
    expect(await storage.objectExists(key.file_key)).toBe(false);
  });

  it('never leaks resumes across candidate accounts (404)', async () => {
    const owner = await candSignup(test, ns.email('owner'));
    const other = await candSignup(test, ns.email('other'));
    const upload = await postJson(
      test.baseUrl,
      '/cand/resume',
      { fileName: 'private.txt', contentBase64: Buffer.from(SAMPLE_RESUME, 'utf8').toString('base64') },
      authed(owner.token),
    );
    expect(upload.status).toBe(201);

    const crossGet = await fetch(`${test.baseUrl}/cand/resume`, { headers: authed(other.token) });
    expect(crossGet.status).toBe(404);
    const crossMatch = await postJson(
      test.baseUrl,
      '/cand/resume/match',
      { jdText: SAMPLE_JD },
      authed(other.token),
    );
    expect(crossMatch.status).toBe(404);
  });

  it('builds a JD-targeted mock that probes the resume gap (from-jd)', async () => {
    const candidate = await candSignup(test, ns.email('from-jd'));
    const upload = await postJson(
      test.baseUrl,
      '/cand/resume',
      { fileName: 'priya.txt', contentBase64: Buffer.from(SAMPLE_RESUME, 'utf8').toString('base64') },
      authed(candidate.token),
    );
    expect(upload.status).toBe(201);

    const created = await postJson(
      test.baseUrl,
      '/cand/practice/from-jd',
      { jdText: SAMPLE_JD, mode: 'text' },
      authed(candidate.token),
    );
    expect(created.status).toBe(201);
    const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
    expect(session.source).toBe('jd');
    expect(session.title).toMatch(/^JD practice:/);

    const detail = (await (
      await fetch(`${test.baseUrl}/cand/practice/${session.id}`, { headers: authed(candidate.token) })
    ).json()) as PracticeSessionDetailResponse;
    expect(detail.questions.length).toBeGreaterThanOrEqual(3);
    // Resume was included → the fixture must add a gap-probe question.
    expect(detail.questions.some((q) => q.topic === 'gap-probe')).toBe(true);
    for (const question of detail.questions) {
      expect(question.rubricLines.length).toBeGreaterThan(0);
    }
    expect(typeof recoveryToken).toBe('string');
  });

  it('rejects short JD text for from-jd and match', async () => {
    const candidate = await candSignup(test, ns.email('short-jd'));
    const fromJd = await postJson(
      test.baseUrl,
      '/cand/practice/from-jd',
      { jdText: 'too short', mode: 'text' },
      authed(candidate.token),
    );
    expect(fromJd.status).toBe(400);

    await postJson(
      test.baseUrl,
      '/cand/resume',
      { fileName: 'r.txt', contentBase64: Buffer.from(SAMPLE_RESUME, 'utf8').toString('base64') },
      authed(candidate.token),
    );
    const match = await postJson(
      test.baseUrl,
      '/cand/resume/match',
      { jdText: 'short' },
      authed(candidate.token),
    );
    expect(match.status).toBe(400);
  });

  it('match produces coverage, missing keywords and honesty-flagged suggestions', async () => {
    const candidate = await candSignup(test, ns.email('match'));
    await postJson(
      test.baseUrl,
      '/cand/resume',
      { fileName: 'priya.txt', contentBase64: Buffer.from(SAMPLE_RESUME, 'utf8').toString('base64') },
      authed(candidate.token),
    );
    const match = await postJson(
      test.baseUrl,
      '/cand/resume/match',
      { jdText: SAMPLE_JD },
      authed(candidate.token),
    );
    expect(match.status).toBe(200);
    const body = (await match.json()) as ResumeJdMatchResponse;
    expect(body.coverage.length).toBeGreaterThan(0);
    // Python/PostgreSQL/Kafka/AWS are in the resume; Terraform is not
    // (fixture lower-cases keywords).
    expect(body.coverage.find((c) => c.keyword.toLowerCase() === 'python')?.present).toBe(true);
    expect(body.missingKeywords.map((k) => k.toLowerCase())).toContain('terraform');
    for (const suggestion of body.suggestions) {
      // Every suggestion carries the honesty guardrail output (mock fixture
      // rewords verbs only, so flags are empty — fabrication cases are unit-tested).
      expect(Array.isArray(suggestion.honestyFlags)).toBe(true);
      expect(suggestion.original.length).toBeGreaterThan(0);
      expect(suggestion.improved.length).toBeGreaterThan(0);
    }
  });
});
