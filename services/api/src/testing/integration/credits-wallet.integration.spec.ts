import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ConsentByTokenResponse,
  CreateCandidateInviteResponse,
  CreateQuestionBody,
  KitDetailResponse,
  PreflightResponse,
  TurnResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  postJson,
  signup,
  waitForEmail,
  MAILPIT_API,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('credits-wallet.test');

interface WalletView {
  balance: number;
  lowBalanceThreshold: number;
  pricing: Record<string, number>;
  ledger: Array<{
    id: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    sessionRef: string | null;
    createdAt: string;
  }>;
}

async function createPublishedKit(
  test: TestApp,
  token: string,
  mode: 'text' | 'voice' = 'text',
): Promise<string> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: `Wallet Kit ${mode}`, role: 'Engineer', level: 'Mid', settings: { mode } },
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const question: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'Tell us about a challenging project.',
    topic: 'Experience',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: randomUUID(), text: 'Clarity', weight: 1 }],
  };
  const add = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, question, bearer(token));
  expect(add.status).toBe(201);
  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  return ((await publish.json()) as { version: { id: string } }).version.id;
}

async function inviteAndConsent(
  test: TestApp,
  token: string,
  kitVersionId: string,
  tag: string,
): Promise<{ sessionId: string; recoveryToken: string }> {
  const inviteRes = await postJson(
    test.baseUrl,
    '/invites',
    {
      kitVersionId,
      candidate: { name: `Wallet Candidate ${tag}`, email: ns.email(tag) },
    },
    bearer(token),
  );
  expect(inviteRes.status).toBe(201);
  const invite = (await inviteRes.json()) as CreateCandidateInviteResponse;

  const consentRes = await postJson(test.baseUrl, `/invites/by-token/${invite.token}/consent`, {
    name: `Wallet Candidate ${tag}`,
  });
  expect(consentRes.status).toBe(200);
  const { session, recoveryToken } = (await consentRes.json()) as ConsentByTokenResponse;
  return { sessionId: session.id, recoveryToken };
}

async function wallet(test: TestApp, token: string): Promise<WalletView> {
  const res = await fetch(`${test.baseUrl}/credits/wallet`, { headers: bearer(token) });
  expect(res.status).toBe(200);
  return (await res.json()) as WalletView;
}

/** Sets the org balance directly (test-only top-up/drain). */
async function setBalance(test: TestApp, orgId: string, target: number): Promise<void> {
  await test.db.transaction(async (q) => {
    await q.query(
      `INSERT INTO credit_account (holder_type, holder_id, balance)
       VALUES ('org', $1, 0)
       ON CONFLICT (holder_type, holder_id) DO NOTHING`,
      [orgId],
    );
    const found = await q.query(
      `SELECT id, balance FROM credit_account WHERE holder_type = 'org' AND holder_id = $1`,
      [orgId],
    );
    const { id: accountId, balance } = found.rows[0] as { id: string; balance: number };
    const delta = target - balance;
    await q.query(`UPDATE credit_account SET balance = $2 WHERE id = $1`, [accountId, target]);
    await q.query(`UPDATE "org" SET credits_balance = $2 WHERE id = $1`, [orgId, target]);
    await q.query(
      `INSERT INTO credit_ledger (account_id, org_id, delta, balance_after, reason)
       VALUES ($1, $2, $3, $4, 'test_adjust')`,
      [accountId, orgId, delta, target],
    );
  });
}

describe.runIf(INTEGRATION_AVAILABLE)('credits wallet (FR-E14)', () => {
  let test: TestApp;
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    // Force the orchestrator-token refund path: nothing listens on this port.
    process.env.ORCHESTRATOR_URL = 'http://127.0.0.1:9';
    test = await bootApp();
    await ns.purge(test.db);
    const account = await signup(test.baseUrl, ns.email('admin'));
    adminToken = account.token;
    orgId = account.org.id;
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('wallet shows the welcome grant, pricing map, and ledger; threshold is admin-only', async () => {
    const view = await wallet(test, adminToken);
    expect(view.balance).toBe(100);
    expect(view.pricing).toEqual({ text: 1, voice: 2, video: 3, human: 1, async_video: 3 });
    expect(view.ledger[0]?.reason).toBe('welcome_grant');
    expect(view.ledger[0]?.delta).toBe(100);
    expect(view.lowBalanceThreshold).toBe(5);

    const patch = await fetch(`${test.baseUrl}/credits/wallet/threshold`, {
      method: 'PATCH',
      headers: { ...bearer(adminToken), 'content-type': 'application/json' },
      body: JSON.stringify({ threshold: 7 }),
    });
    expect(patch.status).toBe(200);
    expect((await wallet(test, adminToken)).lowBalanceThreshold).toBe(7);
  });

  it('debits the mode price when an interview starts; ledger chains balances', async () => {
    await setBalance(test, orgId, 50);
    const kitVersionId = await createPublishedKit(test, adminToken, 'text');
    const { sessionId, recoveryToken } = await inviteAndConsent(test, adminToken, kitVersionId, 'debit');

    const preflight = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/preflight`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);
    const preflightBody = (await preflight.json()) as PreflightResponse;
    expect(preflightBody.session.status).toBe('live');

    const view = await wallet(test, adminToken);
    expect(view.balance).toBe(49);
    const start = view.ledger.find((entry) => entry.reason === 'session_start');
    expect(start?.delta).toBe(-1);
    expect(start?.sessionRef).toBe(sessionId);

    // Complete the interview: no re-charge at completion.
    let turn = preflightBody.turn;
    let i = 0;
    while (turn.type !== 'wrapup') {
      const res = await postJson(
        test.baseUrl,
        `/sessions/${sessionId}/turn`,
        { answer: 'A thorough answer with concrete metrics and outcomes and lessons learned.' },
        { 'x-recovery-token': recoveryToken },
      );
      expect(res.status).toBe(200);
      turn = ((await res.json()) as TurnResponse).turn;
      i += 1;
      expect(i).toBeLessThan(12);
    }
    expect((await wallet(test, adminToken)).balance).toBe(49);
  }, 60_000);

  it('blocks new starts at zero credits but in-flight sessions still complete', async () => {
    const kitVersionId = await createPublishedKit(test, adminToken, 'text');

    // Start one interview while solvent.
    const inFlight = await inviteAndConsent(test, adminToken, kitVersionId, 'inflight');
    const first = await postJson(
      test.baseUrl,
      `/sessions/${inFlight.sessionId}/preflight`,
      {},
      { 'x-recovery-token': inFlight.recoveryToken },
    );
    expect(first.status).toBe(200);

    // Drain to zero: a NEW start is refused with 402.
    await setBalance(test, orgId, 0);
    const blocked = await inviteAndConsent(test, adminToken, kitVersionId, 'blocked');
    const refused = await postJson(
      test.baseUrl,
      `/sessions/${blocked.sessionId}/preflight`,
      {},
      { 'x-recovery-token': blocked.recoveryToken },
    );
    expect(refused.status).toBe(402);

    // The in-flight session answers through to completion without re-charge.
    let turn = ((await first.json()) as PreflightResponse).turn;
    let i = 0;
    while (turn.type !== 'wrapup') {
      const res = await postJson(
        test.baseUrl,
        `/sessions/${inFlight.sessionId}/turn`,
        { answer: 'A thorough answer with concrete metrics and outcomes and lessons learned.' },
        { 'x-recovery-token': inFlight.recoveryToken },
      );
      expect(res.status).toBe(200);
      turn = ((await res.json()) as TurnResponse).turn;
      i += 1;
      expect(i).toBeLessThan(12);
    }
    expect((await wallet(test, adminToken)).balance).toBe(0);
  }, 60_000);

  it('races two simultaneous starts: one wins, one gets 402, ledger stays exact', async () => {
    await setBalance(test, orgId, 1);
    const kitVersionId = await createPublishedKit(test, adminToken, 'text');
    const a = await inviteAndConsent(test, adminToken, kitVersionId, 'race-a');
    const b = await inviteAndConsent(test, adminToken, kitVersionId, 'race-b');

    const [resA, resB] = await Promise.all([
      postJson(test.baseUrl, `/sessions/${a.sessionId}/preflight`, {}, {
        'x-recovery-token': a.recoveryToken,
      }),
      postJson(test.baseUrl, `/sessions/${b.sessionId}/preflight`, {}, {
        'x-recovery-token': b.recoveryToken,
      }),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 402]);

    const view = await wallet(test, adminToken);
    expect(view.balance).toBe(0);
    const starts = view.ledger.filter((entry) => entry.reason === 'session_start');
    expect(starts.length).toBeGreaterThanOrEqual(1);
    // balance_after chains are internally consistent (newest first).
    for (let i = 0; i + 1 < view.ledger.length; i += 1) {
      const newer = view.ledger[i]!;
      const older = view.ledger[i + 1]!;
      expect(newer.balanceAfter - newer.delta).toBe(older.balanceAfter);
    }
  }, 60_000);

  it('refunds the start debit when the orchestrator cannot issue a voice token', async () => {
    await setBalance(test, orgId, 10);
    const kitVersionId = await createPublishedKit(test, adminToken, 'voice');
    const { sessionId, recoveryToken } = await inviteAndConsent(test, adminToken, kitVersionId, 'refund');

    const preflight = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/preflight`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);
    expect((await wallet(test, adminToken)).balance).toBe(8); // voice = 2

    const tokenRes = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/voice/token`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(tokenRes.status).toBe(502);

    const view = await wallet(test, adminToken);
    expect(view.balance).toBe(10);
    const refund = view.ledger.find((entry) => entry.reason === 'system_failure_refund');
    expect(refund?.delta).toBe(2);
    expect(refund?.sessionRef).toBe(sessionId);
  }, 60_000);

  it('emails admins at most once per 24h when the balance drops below threshold', async () => {
    // Fresh org: an earlier test in this file already burned the 24h alert
    // watermark for the shared org (the race test debits to 0).
    const adminEmail = ns.email('lowbal-admin');
    const account = await signup(test.baseUrl, adminEmail);
    const lowToken = account.token;
    const lowOrgId = account.org.id;
    await setBalance(test, lowOrgId, 2);
    const kitVersionId = await createPublishedKit(test, lowToken, 'text');
    const { sessionId, recoveryToken } = await inviteAndConsent(test, lowToken, kitVersionId, 'lowbal');

    const before = await mailpitIdsFor(adminEmail);
    const preflight = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/preflight`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200); // 2 >= 1 (text price)

    await waitForEmail(adminEmail, 'credit balance is low');
    const afterFirst = await mailpitIdsFor(adminEmail);

    // Second debit below threshold within 24h must NOT re-email.
    await setBalance(test, lowOrgId, 1);
    const second = await inviteAndConsent(test, lowToken, kitVersionId, 'lowbal-2');
    const preflight2 = await postJson(
      test.baseUrl,
      `/sessions/${second.sessionId}/preflight`,
      {},
      { 'x-recovery-token': second.recoveryToken },
    );
    expect(preflight2.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await mailpitIdsFor(adminEmail)).toEqual(afterFirst);
    expect(afterFirst.length).toBeGreaterThan(before.length);
  }, 60_000);

  async function mailpitIdsFor(email: string): Promise<string[]> {
    const res = await fetch(`${MAILPIT_API}/api/v1/messages?limit=100`);
    const list = (await res.json()) as {
      messages?: Array<{ ID: string; To: Array<{ Address: string }> }>;
    };
    return (list.messages ?? [])
      .filter((m) => m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()))
      .map((m) => m.ID);
  }
});
