import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CandidateAuthResponse,
  PracticeExtractJdResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bootApp,
  extractOtp,
  makeTestNamespace,
  postJson,
  signup,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('practice-jd-extract.test');

// Host-run tests reach the compose orchestrator over localhost, not the
// docker-network hostname the api container uses.
process.env.ORCHESTRATOR_URL ??= 'http://localhost:8000';

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

describe.runIf(INTEGRATION_AVAILABLE)(
  'practice JD extraction route (Phase 12c, D6)',
  () => {
    let test: TestApp;
    let candidateToken: string;

    beforeAll(async () => {
      test = await bootApp();
      candidateToken = (await candSignup(test, ns.email('cand'))).token;
    });

    afterAll(async () => {
      await ns.purge(test.db);
      await test.app.close();
    });

    it('rejects employer tokens with 403', async () => {
      const employer = await signup(test.baseUrl, ns.email('admin'));
      const res = await postJson(
        test.baseUrl,
        '/cand/practice/extract-jd',
        { fileName: 'jd.txt', contentBase64: Buffer.from('hello').toString('base64') },
        authed(employer.token),
      );
      expect(res.status).toBe(403);
    });

    it('extracts a .txt JD and returns the text', async () => {
      const jdText = 'Senior Backend Engineer\n\nWe are looking for strong TypeScript and Postgres experience.';
      const res = await postJson(
        test.baseUrl,
        '/cand/practice/extract-jd',
        { fileName: 'backend-jd.txt', contentBase64: Buffer.from(jdText, 'utf8').toString('base64') },
        authed(candidateToken),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as PracticeExtractJdResponse;
      expect(body.text).toBe(jdText);
    });

    it('rejects unsupported extensions with 400', async () => {
      const res = await postJson(
        test.baseUrl,
        '/cand/practice/extract-jd',
        {
          fileName: 'jd.docx',
          contentBase64: Buffer.from('not a real docx').toString('base64'),
        },
        authed(candidateToken),
      );
      expect(res.status).toBe(400);
    });

    it('rejects oversized files with 413', async () => {
      const big = Buffer.alloc(1_000_001, 65);
      const res = await postJson(
        test.baseUrl,
        '/cand/practice/extract-jd',
        { fileName: 'huge-jd.txt', contentBase64: big.toString('base64') },
        authed(candidateToken),
      );
      expect(res.status).toBe(413);
    });

    it('rejects missing fileName with 400', async () => {
      const res = await postJson(
        test.baseUrl,
        '/cand/practice/extract-jd',
        { contentBase64: Buffer.from('x').toString('base64') },
        authed(candidateToken),
      );
      expect(res.status).toBe(400);
    });
  },
);
