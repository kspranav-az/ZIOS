import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CandidateAuthResponse,
  PracticeCreateResponse,
  PracticePreflightResponse,
  PracticeTurnResponse,
  SessionTurnResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bootApp,
  extractOtp,
  makeTestNamespace,
  postJson,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('practice-live.test');

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

async function balanceOf(test: TestApp, accountId: string): Promise<number> {
  const res = await test.db.query(
    `SELECT balance FROM credit_account WHERE holder_type = 'candidate' AND holder_id = $1`,
    [accountId],
  );
  return (res.rows[0] as { balance: number }).balance;
}

describe.runIf(INTEGRATION_AVAILABLE)('practice live mode (Phase 12e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('accepts mode live, charges the video price, and drives turns via the conductor route', async () => {
    const candidate = await candSignup(test, ns.email('live-happy'));
    const before = await balanceOf(test, candidate.accountId);

    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'live' },
      authed(candidate.token),
    );
    expect(created.status).toBe(201);
    const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
    expect(session.mode).toBe('live');

    const consented = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/consent`,
      { recordingAllowed: true },
      authed(candidate.token),
    );
    expect(consented.status).toBe(201);

    const preflight = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);
    const { session: liveSession, turn } = (await preflight.json()) as PracticePreflightResponse;
    expect(liveSession.status).toBe('live');
    // Live practice runs the real LiveKit room → priced like video (3).
    const after = await balanceOf(test, candidate.accountId);
    expect(before - after).toBe(3);

    // Orchestrator-facing conductor route: recovery token only, no JWT.
    let current: SessionTurnResponse = turn;
    for (let i = 0; i < 40 && current.type !== 'wrapup'; i += 1) {
      const res = await postJson(
        test.baseUrl,
        `/cand/practice/conductor/${session.id}/turn`,
        { answer: `Answer ${i}: I owned the outcome, aligned the team, and shipped on time.` },
        { 'x-recovery-token': recoveryToken },
      );
      expect(res.status, `conductor turn ${i}`).toBe(200);
      current = ((await res.json()) as PracticeTurnResponse).turn;
    }
    expect(current.type).toBe('wrapup');

    const report = await fetch(`${test.baseUrl}/cand/practice/${session.id}/report`, {
      headers: authed(candidate.token),
    });
    expect(report.status).toBe(200);
    expect(((await report.json()) as { report: unknown }).report).not.toBeNull();
  }, 120_000);

  it('charges exactly once when prefights race (StrictMode double-mount regression)', async () => {
    const candidate = await candSignup(test, ns.email('live-race'));
    const before = await balanceOf(test, candidate.accountId);

    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'live' },
      authed(candidate.token),
    );
    const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
    await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/consent`,
      { recordingAllowed: true },
      authed(candidate.token),
    );

    // Fire concurrently — mirrors React StrictMode's double effect on the
    // live page, which produced two 3-credit debits before the atomic claim.
    const [a, b] = await Promise.all([
      postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/preflight`,
        {},
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      ),
      postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/preflight`,
        {},
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      ),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const after = await balanceOf(test, candidate.accountId);
    expect(before - after).toBe(3);
  }, 90_000);

  it('guards the live token: wrong status, wrong mode, ownership, and loud orchestrator failure', async () => {
    const candidate = await candSignup(test, ns.email('live-guards'));

    // Wrong mode: a text session can never get a live token.
    const textRes = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'text' },
      authed(candidate.token),
    );
    const textCreated = (await textRes.json()) as PracticeCreateResponse;
    const textSession = textCreated.session;
    await postJson(
      test.baseUrl,
      `/cand/practice/${textSession.id}/consent`,
      { recordingAllowed: true },
      authed(candidate.token),
    );
    const wrongMode = await postJson(
      test.baseUrl,
      `/cand/practice/${textSession.id}/live/token`,
      {},
      {
        ...authed(candidate.token),
        'x-recovery-token': textCreated.recoveryToken,
      },
    );
    expect(wrongMode.status).toBe(409);
    expect(((await wrongMode.json()) as { code: string }).code).toBe('SESSION_MODE_INVALID');

    // Live session, not yet preflighted (status consented → 409).
    const liveRes = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'live' },
      authed(candidate.token),
    );
    const { session, recoveryToken } = (await liveRes.json()) as PracticeCreateResponse;
    await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/consent`,
      { recordingAllowed: true },
      authed(candidate.token),
    );
    const tooEarly = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/live/token`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(tooEarly.status).toBe(409);

    // Valid state, orchestrator absent in the hermetic test env → loud 502.
    await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    const noOrch = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/live/token`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(noOrch.status).toBe(502);
    expect(((await noOrch.json()) as { code: string }).code).toBe('ORCHESTRATOR_ERROR');

    // Another candidate's session + token → 404 (no existence leak).
    const other = await candSignup(test, ns.email('live-other'));
    const foreign = await fetch(`${test.baseUrl}/cand/practice/${session.id}/live/token`, {
      method: 'POST',
      headers: {
        ...authed(other.token),
        'content-type': 'application/json',
        'x-recovery-token': recoveryToken,
      },
      body: JSON.stringify({}),
    });
    expect(foreign.status).toBe(404);
  }, 120_000);

  it('rejects invalid modes and bad recovery tokens on the conductor routes', async () => {
    const candidate = await candSignup(test, ns.email('live-conductor-guards'));
    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'bogus' },
      authed(candidate.token),
    );
    expect(created.status).toBe(400);

    const ok = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'live' },
      authed(candidate.token),
    );
    const { session } = (await ok.json()) as PracticeCreateResponse;
    const badToken = await postJson(
      test.baseUrl,
      `/cand/practice/conductor/${session.id}/turn`,
      { answer: 'x' },
      { 'x-recovery-token': 'not-the-token' },
    );
    expect(badToken.status).toBe(401);
  }, 90_000);
});
