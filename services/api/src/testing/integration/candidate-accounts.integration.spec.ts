import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CandidateAuthResponse, CandidateMeResponse } from '@zios/shared-types';
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

const ns = makeTestNamespace('cand-accounts.test');

const CAND = 'Ascend Candidate';

/** Full candidate OTP lifecycle: request code → read Mailpit → verify. */
async function candSignup(
  test: TestApp,
  email: string,
): Promise<{ token: string; body: CandidateAuthResponse }> {
  const req = await postJson(test.baseUrl, '/cand/auth/otp/request', { email });
  expect(req.status).toBe(200);
  const mail = await waitForEmail(email, 'Ascend sign-in code');
  const code = extractOtp(mail.text);
  const verify = await postJson(test.baseUrl, '/cand/auth/otp/verify', { email, code });
  expect(verify.status).toBe(200);
  const body = (await verify.json()) as CandidateAuthResponse;
  return { token: body.session.token, body };
}

describe.runIf(INTEGRATION_AVAILABLE)('candidate accounts (Phase 12, D7/D8)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('signs up with email OTP, provisions the account, and issues the welcome grant', async () => {
    const email = ns.email('fresh');
    const { body } = await candSignup(test, email);

    expect(body.isNewUser).toBe(true);
    const account = body.account;
    expect(account.email.toLowerCase()).toBe(email.toLowerCase());
    expect(account.name).toBe('');
    expect(account.marketingOptIn).toBe(false);

    // Welcome grant: candidate-typed account, 50 credits, ledger row.
    const wallet = await test.db.query(
      `SELECT ca.id, ca.balance, ca.holder_type FROM credit_account ca
       WHERE ca.holder_type = 'candidate' AND ca.holder_id = $1`,
      [account.id],
    );
    expect(wallet.rowCount).toBe(1);
    const row = wallet.rows[0] as { id: string; balance: number; holder_type: string };
    expect(row.balance).toBe(50);
    expect(row.holder_type).toBe('candidate');

    const ledger = await test.db.query(
      `SELECT reason, delta, metadata, org_id FROM credit_ledger WHERE account_id = $1`,
      [row.id],
    );
    expect(ledger.rowCount).toBe(1);
    const entry = ledger.rows[0] as {
      reason: string;
      delta: number;
      metadata: { product?: string };
      org_id: string | null;
    };
    expect(entry.reason).toBe('welcome_grant');
    expect(entry.delta).toBe(50);
    expect(entry.metadata.product).toBe('ascend');
    expect(entry.org_id).toBeNull(); // candidates have no org
  }, 60_000);

  it('reuses the account on repeat login without a second welcome grant', async () => {
    const email = ns.email('repeat');
    const first = await candSignup(test, email);
    expect(first.body.isNewUser).toBe(true);

    const second = await candSignup(test, email);
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.account.id).toBe(first.body.account.id);

    const wallet = await test.db.query(
      `SELECT balance FROM credit_account WHERE holder_type = 'candidate' AND holder_id = $1`,
      [first.body.account.id],
    );
    expect((wallet.rows[0] as { balance: number }).balance).toBe(50);

    const me = await fetch(`${test.baseUrl}/cand/me`, {
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as CandidateMeResponse;
    expect(meBody.account.id).toBe(first.body.account.id);
  }, 90_000);

  it('patches onboarding (name + target role) via /cand/me', async () => {
    const email = ns.email('onboard');
    const { token } = await candSignup(test, email);

    const patch = await fetch(`${test.baseUrl}/cand/me`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: CAND, targetRole: 'Backend Engineer' }),
    });
    expect(patch.status).toBe(200);
    const account = ((await patch.json()) as CandidateMeResponse).account;
    expect(account.name).toBe(CAND);
    expect(account.targetRole).toBe('Backend Engineer');
    expect((account.onboarding as { onboarded?: boolean }).onboarded).toBe(true);
  }, 60_000);

  it('rejects employer session tokens on /cand/* with 403 audience violation', async () => {
    const employer = await signup(test.baseUrl, ns.email('employer'));
    const me = await fetch(`${test.baseUrl}/cand/me`, {
      headers: { authorization: `Bearer ${employer.token}` },
    });
    expect(me.status).toBe(403);
    expect(((await me.json()) as { code?: string }).code).toBe('INVALID_TOKEN_AUDIENCE');

    const patch = await fetch(`${test.baseUrl}/cand/me`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${employer.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(patch.status).toBe(403);
  }, 60_000);

  it('rejects garbage tokens with 401 and cross-audience OTP codes', async () => {
    const me = await fetch(`${test.baseUrl}/cand/me`, {
      headers: { authorization: 'Bearer garbage-token' },
    });
    expect(me.status).toBe(401);

    // An employer-audience code must not verify on the candidate endpoint.
    const email = ns.email('cross-aud');
    await signup(test.baseUrl, email); // issues an employer-audience OTP
    const mail = await waitForEmail(email, 'InterviewOS sign-in code');
    const employerCode = extractOtp(mail.text);
    const verify = await postJson(test.baseUrl, '/cand/auth/otp/verify', {
      email,
      code: employerCode,
    });
    expect(verify.status).toBe(401);
  }, 60_000);

  it('candidate session cannot be used on employer routes', async () => {
    const email = ns.email('no-cross');
    const { token } = await candSignup(test, email);
    const me = await fetch(`${test.baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(401);
  }, 60_000);
});
