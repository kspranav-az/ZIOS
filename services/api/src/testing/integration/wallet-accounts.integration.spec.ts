import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConsentByTokenResponse, CreateCandidateInviteResponse, CreateQuestionBody, KitDetailResponse } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  postJson,
  signup,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('wallet-accounts.test');

interface AccountRow {
  id: string;
  holder_type: string;
  holder_id: string;
  balance: number;
  low_balance_threshold: number;
}

async function accountForOrg(test: TestApp, orgId: string): Promise<AccountRow> {
  const res = await test.db.query(
    `SELECT id, holder_type, holder_id, balance, low_balance_threshold
     FROM credit_account WHERE holder_type = 'org' AND holder_id = $1`,
    [orgId],
  );
  expect(res.rowCount).toBe(1);
  return res.rows[0] as AccountRow;
}

async function orgCacheBalance(test: TestApp, orgId: string): Promise<number> {
  const res = await test.db.query(`SELECT credits_balance FROM "org" WHERE id = $1`, [orgId]);
  return Number((res.rows[0] as { credits_balance: number }).credits_balance);
}

async function createPublishedKit(test: TestApp, token: string): Promise<string> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'WalletAccounts Kit', role: 'Engineer', level: 'Mid', settings: { mode: 'text' } },
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
    rubricLines: [{ id: crypto.randomUUID(), text: 'Clarity', weight: 1 }],
  };
  const add = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, question, bearer(token));
  expect(add.status).toBe(201);
  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  return ((await publish.json()) as { version: { id: string } }).version.id;
}

describe.runIf(INTEGRATION_AVAILABLE)('credit accounts (Phase 12, D1-D3)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('provisions exactly one org account on signup with the welcome grant', async () => {
    const email = ns.email('acct-admin');
    const { org } = await signup(test.baseUrl, email);

    const account = await accountForOrg(test, org.id);
    expect(account.balance).toBe(100);
    expect(account.low_balance_threshold).toBe(5);
    expect(await orgCacheBalance(test, org.id)).toBe(100);

    const ledger = await test.db.query(
      `SELECT reason, delta, balance_after, account_id, org_id
       FROM credit_ledger WHERE account_id = $1`,
      [account.id],
    );
    expect(ledger.rowCount).toBe(1);
    const row = ledger.rows[0] as {
      reason: string;
      delta: number;
      balance_after: number;
      account_id: string;
      org_id: string;
    };
    expect(row.reason).toBe('welcome_grant');
    expect(row.delta).toBe(100);
    expect(row.balance_after).toBe(100);
    expect(row.account_id).toBe(account.id);
    expect(row.org_id).toBe(org.id);
  }, 60_000);

  it('creates a single account under concurrent insert-if-absent (unique holder)', async () => {
    const email = ns.email('race-admin');
    const { org } = await signup(test.baseUrl, email);
    await test.db.query(`DELETE FROM credit_account WHERE holder_type = 'org' AND holder_id = $1`, [
      org.id,
    ]);

    const insertIfAbsent = () =>
      test.db.query(
        `INSERT INTO credit_account (holder_type, holder_id)
         VALUES ('org', $1)
         ON CONFLICT (holder_type, holder_id) DO NOTHING
         RETURNING id`,
        [org.id],
      );
    const [first, second] = await Promise.all([insertIfAbsent(), insertIfAbsent()]);
    // Exactly one of the two concurrent inserts wins; the other conflicts.
    expect(Number(first.rowCount) + Number(second.rowCount)).toBe(1);
    await accountForOrg(test, org.id); // throws unless exactly one row exists
  }, 60_000);

  it('moves the low-balance threshold onto the account (web contract unchanged)', async () => {
    const email = ns.email('thr-admin');
    const { token, org } = await signup(test.baseUrl, email);

    const patch = await fetch(`${test.baseUrl}/credits/wallet/threshold`, {
      method: 'PATCH',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ threshold: 42 }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { lowBalanceThreshold: number }).lowBalanceThreshold).toBe(42);

    const account = await accountForOrg(test, org.id);
    expect(account.low_balance_threshold).toBe(42);

    const wallet = await fetch(`${test.baseUrl}/credits/wallet`, { headers: bearer(token) });
    const view = (await wallet.json()) as { balance: number; lowBalanceThreshold: number };
    expect(view.lowBalanceThreshold).toBe(42);
    expect(view.balance).toBe(100);
  }, 60_000);

  it('debits the account and keeps the org cache in sync through the live transition', async () => {
    const email = ns.email('debit-admin');
    const { token, org } = await signup(test.baseUrl, email);
    const account = await accountForOrg(test, org.id);
    const kitVersionId = await createPublishedKit(test, token);

    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      { kitVersionId, candidate: { name: 'WA Candidate', email: ns.email('debit-cand') } },
      bearer(token),
    );
    expect(inviteRes.status).toBe(201);
    const invite = (await inviteRes.json()) as CreateCandidateInviteResponse;
    const consentRes = await postJson(test.baseUrl, `/invites/by-token/${invite.token}/consent`, {
      name: 'WA Candidate',
    });
    expect(consentRes.status).toBe(200);
    const { session, recoveryToken } = (await consentRes.json()) as ConsentByTokenResponse;

    const preflight = await postJson(
      test.baseUrl,
      `/sessions/${session.id}/preflight`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);

    const after = await accountForOrg(test, org.id);
    expect(after.balance).toBe(account.balance - 1); // text mode = 1 credit
    expect(await orgCacheBalance(test, org.id)).toBe(after.balance);

    const ledger = await test.db.query(
      `SELECT reason, delta, account_id, org_id FROM credit_ledger
       WHERE account_id = $1 AND reason = 'session_start'`,
      [account.id],
    );
    expect(ledger.rowCount).toBe(1);
    const row = ledger.rows[0] as { delta: number; account_id: string; org_id: string };
    expect(row.delta).toBe(-1);
    expect(row.account_id).toBe(account.id);
    expect(row.org_id).toBe(org.id);
  }, 90_000);
});
