import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CandidateAuthResponse,
  CandidateProgressResponse,
  CandidateReadinessResponse,
  CandidateWalletResponse,
  PracticeCreateResponse,
  PracticePreflightResponse,
  PracticeSessionDetailResponse,
  PracticeTurnResponse,
  SessionTurnResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  MAILPIT_API,
  bootApp,
  extractOtp,
  makeTestNamespace,
  postJson,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('practice-progress.test');

const ALERT_SUBJECT = 'Ascend: your practice credits are running low';

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

async function getJson(
  test: TestApp,
  path: string,
  token: string,
): Promise<Response> {
  return fetch(`${test.baseUrl}${path}`, { headers: authed(token) });
}

/** Consent + preflight a fresh library session (drives one practice_start debit). */
async function startSession(
  test: TestApp,
  token: string,
  packId = 'hr-screening',
): Promise<{ sessionId: string; recoveryToken: string; firstTurn: SessionTurnResponse }> {
  const created = await postJson(
    test.baseUrl,
    '/cand/practice',
    { packId, mode: 'text' },
    authed(token),
  );
  expect(created.status).toBe(201);
  const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;

  const consent = await postJson(
    test.baseUrl,
    `/cand/practice/${session.id}/consent`,
    { recordingAllowed: true, modelOptIn: false },
    authed(token),
  );
  expect(consent.status).toBe(201);

  const preflight = await postJson(
    test.baseUrl,
    `/cand/practice/${session.id}/preflight`,
    {},
    { ...authed(token), 'x-recovery-token': recoveryToken },
  );
  expect(preflight.status).toBe(200);
  const { turn } = (await preflight.json()) as PracticePreflightResponse;
  return { sessionId: session.id, recoveryToken, firstTurn: turn };
}

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

/** Count Mailpit messages for a recipient + subject fragment. */
async function countEmails(to: string, subjectIncludes: string): Promise<number> {
  const res = await fetch(`${MAILPIT_API}/api/v1/messages?limit=200`);
  const list = (await res.json()) as {
    messages?: Array<{ To: Array<{ Address: string }>; Subject: string }>;
  };
  return (list.messages ?? []).filter(
    (m) =>
      m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
      m.Subject.includes(subjectIncludes),
  ).length;
}

describe.runIf(INTEGRATION_AVAILABLE)(
  'progress, readiness, wallet ledger + low-balance alert (Phase 12, D14/D15, FR-E14)',
  () => {
    let test: TestApp;

    beforeAll(async () => {
      test = await bootApp();
    });

    afterAll(async () => {
      await ns.purge(test.db);
      await test.app.close();
    });

    it('wallet exposes the append-only ledger (welcome grant + practice debits)', async () => {
      const email = ns.email('wallet');
      const candidate = await candSignup(test, email);

      const created = await postJson(
        test.baseUrl,
        '/cand/practice',
        { packId: 'hr-screening', mode: 'text' },
        authed(candidate.token),
      );
      expect(created.status).toBe(201);
      const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
      const consent = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/consent`,
        { recordingAllowed: true, modelOptIn: false },
        authed(candidate.token),
      );
      expect(consent.status).toBe(201);
      const preflight = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/preflight`,
        {},
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      );
      expect(preflight.status).toBe(200);

      const walletRes = await getJson(test, '/cand/wallet', candidate.token);
      expect(walletRes.status).toBe(200);
      const wallet = (await walletRes.json()) as CandidateWalletResponse;
      expect(wallet.balance).toBe(49);
      expect(wallet.ledger.length).toBeGreaterThanOrEqual(2);

      const reasons = wallet.ledger.map((e) => e.reason);
      expect(reasons).toContain('welcome_grant');
      expect(reasons).toContain('practice_start');

      const welcome = wallet.ledger.find((e) => e.reason === 'welcome_grant');
      expect(welcome?.delta).toBe(50);
      const debit = wallet.ledger.find((e) => e.reason === 'practice_start');
      expect(debit?.delta).toBe(-1);
      expect(debit?.balanceAfter).toBe(49);
      // Newest first.
      expect(wallet.ledger[0]?.reason).toBe('practice_start');
    }, 120_000);

    it('progress + readiness reflect a completed, judged mock (D14/D15)', async () => {
      const email = ns.email('progress');
      const candidate = await candSignup(test, email);

      // Fresh account: readiness has no inputs yet.
      const emptyRes = await getJson(test, '/cand/practice/readiness', candidate.token);
      expect(emptyRes.status).toBe(200);
      const empty = (await emptyRes.json()) as CandidateReadinessResponse;
      expect(empty.readiness).toBeNull();
      expect(empty.components).toBeNull();
      expect(empty.sessionsUsed).toBe(0);
      expect(empty.formulaVersion).toBe('READINESS_FORMULA_V1');

      const { sessionId, recoveryToken, firstTurn } = await startSession(test, candidate.token);
      await runToCompletion(test, candidate.token, sessionId, recoveryToken, firstTurn);

      const detail = (await (
        await getJson(test, `/cand/practice/${sessionId}`, candidate.token)
      ).json()) as PracticeSessionDetailResponse;
      expect(detail.session.status).toBe('completed');

      const progressRes = await getJson(test, '/cand/practice/progress', candidate.token);
      expect(progressRes.status).toBe(200);
      const progress = (await progressRes.json()) as CandidateProgressResponse;
      expect(progress.sessions.length).toBe(1);
      expect(progress.sessions[0]?.id).toBe(sessionId);
      expect(progress.sessions[0]?.status).toBe('completed');
      expect(progress.trends.length).toBe(1);
      expect(progress.trends[0]?.overallRecommendation).toBeGreaterThanOrEqual(1);
      expect(progress.trends[0]?.paceWpm).toBeGreaterThan(0);
      expect(progress.streak.current).toBe(1);
      expect(progress.dailyCap).toBe(3);

      const readinessRes = await getJson(test, '/cand/practice/readiness', candidate.token);
      expect(readinessRes.status).toBe(200);
      const readiness = (await readinessRes.json()) as CandidateReadinessResponse;
      expect(readiness.readiness).not.toBeNull();
      expect(readiness.readiness as number).toBeGreaterThanOrEqual(0);
      expect(readiness.readiness as number).toBeLessThanOrEqual(100);
      expect(readiness.formulaVersion).toBe('READINESS_FORMULA_V1');
      expect(readiness.components).not.toBeNull();
      expect(readiness.components?.scoreBlend).toBeGreaterThan(0);
      // pace depends on wall-clock typing speed of the mock answers; only
      // assert the component is present and within range.
      expect(readiness.components?.paceScore).toBeGreaterThanOrEqual(0);
      expect(readiness.components?.paceScore).toBeLessThanOrEqual(100);
      expect(readiness.components?.fillerScore).toBeGreaterThanOrEqual(0);
      expect(readiness.components?.structureScore).toBeGreaterThanOrEqual(0);
      expect(readiness.sessionsUsed).toBe(1);
    }, 180_000);

    it('low-balance alert emails the candidate once per 24h on practice debit (FR-E14-3)', async () => {
      const email = ns.email('lowbal');
      const candidate = await candSignup(test, email);

      // Push the alert line above the 50-credit welcome grant so the first
      // practice debit (50 → 49) crosses it.
      await test.db.query(
        `UPDATE credit_account SET low_balance_threshold = 60
         WHERE holder_type = 'candidate' AND holder_id = $1`,
        [candidate.accountId],
      );

      await startSession(test, candidate.token);
      const alert = await waitForEmail(email, ALERT_SUBJECT);
      expect(alert.text).toContain('49');
      expect(alert.text).toContain('60');
      expect(alert.text).toContain('once per 24 hours');

      // Second debit within the watermark window sends no duplicate.
      await startSession(test, candidate.token);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await countEmails(email, ALERT_SUBJECT)).toBe(1);
    }, 180_000);
  },
);
