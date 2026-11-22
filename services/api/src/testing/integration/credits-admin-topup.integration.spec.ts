import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const ns = makeTestNamespace('credits-topup.test');

interface TopupResponse {
  balance: number;
  ledgerEntryId: string;
}

interface WalletView {
  balance: number;
  ledger: Array<{
    id: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

/**
 * Admin credit top-up (plans/admin-credit-topup.md): POST /credits/admin/topup
 * is the only manual balance path — every grant produces an admin_grant
 * credit_ledger row and keeps org.credits_balance in sync.
 */
describe.skipIf(!INTEGRATION_AVAILABLE)('credits admin topup (integration)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('grants credits with an admin_grant ledger row and synced org cache', async () => {
    const admin = await signup(test.baseUrl, ns.email('admin'));
    // Establish the pre-topup balance from the wallet itself (the signup
    // org snapshot predates the welcome grant's account sync).
    const walletBeforeRes = await fetch(`${test.baseUrl}/credits/wallet`, { headers: bearer(admin.token) });
    const before = ((await walletBeforeRes.json()) as WalletView).balance;

    const res = await postJson(
      test.baseUrl,
      '/credits/admin/topup',
      { amount: 1000, note: 'test topup' },
      bearer(admin.token),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as TopupResponse;
    expect(body.balance).toBe(before + 1000);
    expect(body.ledgerEntryId).toBeTruthy();

    const walletRes = await fetch(`${test.baseUrl}/credits/wallet`, { headers: bearer(admin.token) });
    const wallet = (await walletRes.json()) as WalletView;
    expect(wallet.balance).toBe(before + 1000);

    const grant = wallet.ledger.find((entry) => entry.id === body.ledgerEntryId);
    expect(grant).toBeDefined();
    expect(grant!.reason).toBe('admin_grant');
    expect(grant!.delta).toBe(1000);
    expect(grant!.balanceAfter).toBe(before + 1000);
    expect(grant!.metadata.grantedByUserId).toBe(admin.user.id);
    expect(grant!.metadata.note).toBe('test topup');

    // Org cache stays in sync with the account balance.
    const meRes = await fetch(`${test.baseUrl}/auth/me`, { headers: bearer(admin.token) });
    const me = (await meRes.json()) as { org: { creditsBalance: number } };
    expect(me.org.creditsBalance).toBe(before + 1000);
  });

  it('rejects non-admin members with 403 and anonymous callers with 401', async () => {
    const admin = await signup(test.baseUrl, ns.email('owner'));

    // Invite an interviewer teammate (FR-E1-3 org invites), then accept as
    // that user so they land in the admin's org with role 'interviewer'.
    const memberEmail = ns.email('member');
    const inviteRes = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email: memberEmail, role: 'interviewer' },
      bearer(admin.token),
    );
    expect(inviteRes.status).toBe(201);
    const inviteMail = await waitForEmail(memberEmail, 'invited you to InterviewOS');
    const rawToken = extractInviteToken(inviteMail.text);

    const member = await signup(test.baseUrl, memberEmail);
    const acceptRes = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: rawToken },
      bearer(member.token),
    );
    expect(acceptRes.status).toBe(200);
    // Accepting the invite moves orgs; grab a fresh session before checking
    // the resulting role.
    const memberAfter = await signup(test.baseUrl, memberEmail);
    const me = (await (
      await fetch(`${test.baseUrl}/auth/me`, { headers: bearer(memberAfter.token) })
    ).json()) as { user: { role: string } };
    expect(me.user.role).toBe('interviewer');

    const forbidden = await postJson(
      test.baseUrl,
      '/credits/admin/topup',
      { amount: 10 },
      bearer(memberAfter.token),
    );
    expect(forbidden.status).toBe(403);

    const anonymous = await fetch(`${test.baseUrl}/credits/admin/topup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 10 }),
    });
    expect(anonymous.status).toBe(401);
  });

  it('rejects invalid amounts and oversized notes with 400', async () => {
    const admin = await signup(test.baseUrl, ns.email('validator'));
    const cases: Array<Record<string, unknown>> = [
      { amount: 0 },
      { amount: -5 },
      { amount: 1.5 },
      { amount: 2_000_000 },
      {},
      { amount: 100, note: 'x'.repeat(201) },
    ];
    for (const body of cases) {
      const res = await postJson(
        test.baseUrl,
        '/credits/admin/topup',
        body,
        bearer(admin.token),
      );
      expect(res.status).toBe(400);
    }
  });
});
