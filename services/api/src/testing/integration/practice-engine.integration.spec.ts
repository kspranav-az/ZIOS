import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CandidateAuthResponse,
  PracticeCreateResponse,
  PracticePreflightResponse,
  PracticeSessionDetailResponse,
  PracticeTurnResponse,
  SessionTurnResponse,
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

const ns = makeTestNamespace('practice-engine.test');

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

/** Answers turns until the conductor wraps up (guarded loop). */
async function runToCompletion(
  test: TestApp,
  token: string,
  sessionId: string,
  recoveryToken: string,
  firstTurn: SessionTurnResponse,
): Promise<void> {
  let turn = firstTurn;
  for (let i = 0; i < 40 && turn.type !== 'wrapup'; i += 1) {
    const res = await postJson(
      test.baseUrl,
      `/cand/practice/${sessionId}/turn`,
      { answer: `Answer ${i}: I structured the work, shipped iteratively, and measured outcomes.` },
      { ...authed(token), 'x-recovery-token': recoveryToken },
    );
    if (res.status !== 200) {
      throw new Error(`turn ${i} failed: ${res.status} ${await res.text()}`);
    }
    turn = ((await res.json()) as PracticeTurnResponse).turn;
  }
  expect(turn.type).toBe('wrapup');
}

describe.runIf(INTEGRATION_AVAILABLE)('practice engine (Phase 12, D5/D9, X8)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('rejects employer tokens with 403 on every /cand/practice/* route', async () => {
    const employer = await signup(test.baseUrl, ns.email('wall-employer'));
    const candidate = await candSignup(test, ns.email('wall-candidate'));

    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'text' },
      authed(candidate.token),
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as PracticeCreateResponse;

    const routes: Array<[string, string]> = [
      ['GET', `/cand/practice/library`],
      ['POST', `/cand/practice`],
      ['GET', `/cand/practice/${session.id}`],
      ['POST', `/cand/practice/${session.id}/consent`],
      ['POST', `/cand/practice/${session.id}/preflight`],
      ['POST', `/cand/practice/${session.id}/turn`],
      ['POST', `/cand/practice/${session.id}/abandon`],
      ['POST', `/cand/practice/${session.id}/recover`],
      ['GET', `/cand/practice/${session.id}/report`],
    ];
    for (const [method, path] of routes) {
      const res = await fetch(`${test.baseUrl}${path}`, {
        method,
        headers: { ...authed(employer.token), 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  }, 90_000);

  it('never leaks sessions across candidate accounts (404)', async () => {
    const a = await candSignup(test, ns.email('iso-a'));
    const b = await candSignup(test, ns.email('iso-b'));
    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'text' },
      authed(a.token),
    );
    const { session } = (await created.json()) as PracticeCreateResponse;

    const detail = await fetch(`${test.baseUrl}/cand/practice/${session.id}`, {
      headers: authed(b.token),
    });
    expect(detail.status).toBe(404);
    const report = await fetch(`${test.baseUrl}/cand/practice/${session.id}/report`, {
      headers: authed(b.token),
    });
    expect(report.status).toBe(200); // guarded route returns empty shape, no rows
    expect(((await report.json()) as { report: unknown }).report).toBeNull();
  }, 90_000);

  it('requires consent before going live (X8 → 409 CONSENT_REQUIRED)', async () => {
    const candidate = await candSignup(test, ns.email('consent-gate'));
    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'behavioral-core', mode: 'text' },
      authed(candidate.token),
    );
    const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;

    const preflight = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(409);
    expect(((await preflight.json()) as { code: string }).code).toBe('CONSENT_REQUIRED');
  }, 60_000);

  it('runs a full text-mode lifecycle: consent → live debit → turns → wrapup → report', async () => {
    const candidate = await candSignup(test, ns.email('lifecycle'));
    const balanceBefore = (
      await test.db.query(
        `SELECT balance FROM credit_account WHERE holder_type = 'candidate' AND holder_id = $1`,
        [candidate.accountId],
      )
    ).rows[0] as { balance: number };

    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'text' },
      authed(candidate.token),
    );
    expect(created.status).toBe(201);
    const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
    expect(session.status).toBe('created');
    expect(session.source).toBe('library');

    const consent = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/consent`,
      { recordingAllowed: true, modelOptIn: false },
      authed(candidate.token),
    );
    expect(consent.status).toBe(201);
    expect(((await consent.json()) as { session: { status: string } }).session.status).toBe(
      'consented',
    );

    const preflight = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);
    const { session: liveSession, turn } = (await preflight.json()) as PracticePreflightResponse;
    expect(liveSession.status).toBe('live');
    expect(turn.type).toBe('question');

    // Exact debit at the live transition: text mode = 1 credit.
    const balanceAfter = (
      await test.db.query(
        `SELECT balance FROM credit_account WHERE holder_type = 'candidate' AND holder_id = $1`,
        [candidate.accountId],
      )
    ).rows[0] as { balance: number };
    expect(balanceAfter.balance).toBe(balanceBefore.balance - 1);
    const debit = await test.db.query(
      `SELECT reason, delta FROM credit_ledger cl
       JOIN credit_account ca ON ca.id = cl.account_id
       WHERE ca.holder_type = 'candidate' AND ca.holder_id = $1 AND reason = 'practice_start'`,
      [candidate.accountId],
    );
    expect(debit.rowCount).toBe(1);
    expect((debit.rows[0] as { delta: number }).delta).toBe(-1);

    await runToCompletion(test, candidate.token, session.id, recoveryToken, turn);

    const detail = (await (
      await fetch(`${test.baseUrl}/cand/practice/${session.id}`, { headers: authed(candidate.token) })
    ).json()) as PracticeSessionDetailResponse;
    expect(detail.session.status).toBe('completed');
    const answered = detail.transcript.filter((row) => row.answerText !== null);
    expect(answered.length).toBeGreaterThan(0);

    // Evaluation ran on the practice transcript → report with cited evidence.
    const reportRes = await fetch(`${test.baseUrl}/cand/practice/${session.id}/report`, {
      headers: authed(candidate.token),
    });
    expect(reportRes.status).toBe(200);
    const report = (await reportRes.json()) as {
      report: { status: string; overallRecommendation: number | null } | null;
      scores: Array<{ score: number; evidenceSpanIds: string[] }>;
      evidenceSpans: Array<{ quoteText: string }>;
      coachingTips: Array<{ category: string; tip: string; quoteText: string }>;
    };
    expect(report.report?.status).toBe('completed');
    expect(report.report?.overallRecommendation).toBeGreaterThanOrEqual(1);
    expect(report.scores.length).toBeGreaterThan(0);
    for (const score of report.scores) {
      expect(score.evidenceSpanIds.length).toBeGreaterThan(0);
    }
    expect(report.evidenceSpans.length).toBeGreaterThan(0);

    // Coaching tips (D9): every tip cites a verbatim evidence-span quote and
    // the tips cost was folded into the report cost.
    expect(report.coachingTips.length).toBeGreaterThan(0);
    const quotes = new Set(report.evidenceSpans.map((span) => span.quoteText));
    for (const tip of report.coachingTips) {
      expect(tip.tip.length).toBeGreaterThan(0);
      expect(quotes.has(tip.quoteText)).toBe(true);
    }
    const reportRow = (
      await test.db.query(`SELECT cost, coaching_tips_cost FROM practice_report WHERE session_id = $1`, [
        session.id,
      ])
    ).rows[0] as { cost: number; coaching_tips_cost: number };
    expect(Number(reportRow.coaching_tips_cost)).toBeGreaterThan(0);
    expect(Number(reportRow.cost)).toBeGreaterThanOrEqual(Number(reportRow.coaching_tips_cost));

    // Wallet view: welcome grant minus the exact practice debit.
    const wallet = await fetch(`${test.baseUrl}/cand/wallet`, { headers: authed(candidate.token) });
    expect(wallet.status).toBe(200);
    const walletBody = (await wallet.json()) as { balance: number; lowBalanceThreshold: number };
    expect(walletBody.balance).toBe(balanceBefore.balance - 1);
    expect(walletBody.lowBalanceThreshold).toBeGreaterThanOrEqual(0);
  }, 180_000);

  it('402 at zero balance with the in-flight session preserved', async () => {
    const candidate = await candSignup(test, ns.email('broke'));
    await test.db.query(
      `UPDATE credit_account SET balance = 0 WHERE holder_type = 'candidate' AND holder_id = $1`,
      [candidate.accountId],
    );

    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'text' },
      authed(candidate.token),
    );
    const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
    await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/consent`,
      { recordingAllowed: true },
      authed(candidate.token),
    );

    const preflight = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(402);
    expect(((await preflight.json()) as { code: string }).code).toBe('INSUFFICIENT_CREDITS');

    // Session stays consented (no half-live state) and nothing was debited.
    const detail = (await (
      await fetch(`${test.baseUrl}/cand/practice/${session.id}`, { headers: authed(candidate.token) })
    ).json()) as PracticeSessionDetailResponse;
    expect(detail.session.status).toBe('consented');
    const ledger = await test.db.query(
      `SELECT cl.id FROM credit_ledger cl
       JOIN credit_account ca ON ca.id = cl.account_id
       WHERE ca.holder_type = 'candidate' AND ca.holder_id = $1 AND reason = 'practice_start'`,
      [candidate.accountId],
    );
    expect(ledger.rowCount).toBe(0);
  }, 90_000);

  it('abandon → recover mints a fresh recovery token and restores consented', async () => {
    const candidate = await candSignup(test, ns.email('recovery'));
    const created = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'text' },
      authed(candidate.token),
    );
    const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
    await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/consent`,
      { recordingAllowed: true },
      authed(candidate.token),
    );
    const preflight = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);

    const abandon = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/abandon`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(abandon.status).toBe(201);

    const recover = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/recover`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(recover.status).toBe(201);
    const recovered = (await recover.json()) as { session: { status: string }; recoveryToken: string };
    expect(recovered.session.status).toBe('consented');
    expect(recovered.recoveryToken).not.toBe(recoveryToken);

    // Old token is dead, new token works.
    const oldPreflight = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
    );
    expect(oldPreflight.status).toBe(401);
    const newPreflight = await postJson(
      test.baseUrl,
      `/cand/practice/${session.id}/preflight`,
      {},
      { ...authed(candidate.token), 'x-recovery-token': recovered.recoveryToken },
    );
    expect(newPreflight.status).toBe(200);
  }, 120_000);

  it('daily cap (D11) blocks the 4th completed mock', async () => {
    const candidate = await candSignup(test, ns.email('capped'));
    // Simulate three completed mocks today (cap math is what we test here;
    // the completion path itself is covered by the lifecycle spec).
    for (let i = 0; i < 3; i += 1) {
      const created = await postJson(
        test.baseUrl,
        '/cand/practice',
        { packId: 'hr-screening', mode: 'text' },
        authed(candidate.token),
      );
      const { session } = (await created.json()) as PracticeCreateResponse;
      await test.db.query(
        `UPDATE practice_session SET status = 'completed', started_at = now() WHERE id = $1`,
        [session.id],
      );
    }
    const fourth = await postJson(
      test.baseUrl,
      '/cand/practice',
      { packId: 'hr-screening', mode: 'text' },
      authed(candidate.token),
    );
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { code: string }).code).toBe('DAILY_CAP_REACHED');
  }, 120_000);
});
