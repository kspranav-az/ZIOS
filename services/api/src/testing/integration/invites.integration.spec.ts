import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AcceptInviteResponse,
  ApiError,
  AppUser,
  CreateInviteResponse,
  MeResponse,
  MembersResponse,
} from '@zios/shared-types';
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

const ns = makeTestNamespace('e2e-inv.test');

describe.skipIf(!INTEGRATION_AVAILABLE)('org invites (integration)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  async function inviteAndGetToken(
    adminToken: string,
    email: string,
    role: 'admin' | 'interviewer' = 'interviewer',
  ): Promise<{ invite: CreateInviteResponse['invite']; rawToken: string }> {
    const created = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email, role },
      bearer(adminToken),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as CreateInviteResponse;
    // The API response must never carry the raw token.
    expect(JSON.stringify(body)).not.toContain('token');
    const mail = await waitForEmail(email, 'invited you to InterviewOS');
    return { invite: body.invite, rawToken: extractInviteToken(mail.text) };
  }

  it('runs the full invite flow: admin invites → email lands in Mailpit → teammate joins with role', async () => {
    const admin = await signup(test.baseUrl, ns.email('admin'));
    const teammateEmail = ns.email('teammate');

    const { invite, rawToken } = await inviteAndGetToken(admin.token, teammateEmail);
    expect(invite).toMatchObject({
      email: teammateEmail,
      role: 'interviewer',
      orgId: admin.org.id,
    });
    expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // The teammate first passes OTP (auto-provisions their own org)…
    const teammate = await signup(test.baseUrl, teammateEmail);
    expect(teammate.org.id).not.toBe(admin.org.id);
    expect(teammate.user.role).toBe('admin'); // admin of their own fresh org

    // …then accepts the invite and lands in the admin's org as interviewer.
    const accepted = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: rawToken },
      bearer(teammate.token),
    );
    expect(accepted.status).toBe(200);
    const joined = (await accepted.json()) as AcceptInviteResponse;
    expect(joined.user.orgId).toBe(admin.org.id);
    expect(joined.user.role).toBe('interviewer');
    expect(joined.org.id).toBe(admin.org.id);

    const me = await fetch(`${test.baseUrl}/auth/me`, { headers: bearer(teammate.token) });
    expect(((await me.json()) as MeResponse).org.id).toBe(admin.org.id);

    const members = await fetch(`${test.baseUrl}/orgs/current/members`, {
      headers: bearer(admin.token),
    });
    expect(members.status).toBe(200);
    const roster = ((await members.json()) as MembersResponse).members;
    expect(roster.map((m: AppUser) => m.email).sort()).toEqual(
      [admin.user.email, teammateEmail].sort(),
    );
  });

  it('enforces admin-only routes server-side: interviewer gets 403', async () => {
    const admin = await signup(test.baseUrl, ns.email('boss'));
    const teammateEmail = ns.email('member');
    const { rawToken } = await inviteAndGetToken(admin.token, teammateEmail);
    const teammate = await signup(test.baseUrl, teammateEmail);
    await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: rawToken },
      bearer(teammate.token),
    );

    const createAsInterviewer = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email: ns.email('another'), role: 'interviewer' },
      bearer(teammate.token),
    );
    expect(createAsInterviewer.status).toBe(403);
    expect(((await createAsInterviewer.json()) as ApiError).code).toBe('FORBIDDEN_ROLE');

    const membersAsInterviewer = await fetch(`${test.baseUrl}/orgs/current/members`, {
      headers: bearer(teammate.token),
    });
    expect(membersAsInterviewer.status).toBe(403);

    // …while the admin still can.
    const membersAsAdmin = await fetch(`${test.baseUrl}/orgs/current/members`, {
      headers: bearer(admin.token),
    });
    expect(membersAsAdmin.status).toBe(200);
    const createAsAdmin = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email: ns.email('another'), role: 'admin' },
      bearer(admin.token),
    );
    expect(createAsAdmin.status).toBe(201);
  });

  it('403s when the accepting session email does not match the invite', async () => {
    const admin = await signup(test.baseUrl, ns.email('owner'));
    const { rawToken } = await inviteAndGetToken(admin.token, ns.email('intended'));
    const stranger = await signup(test.baseUrl, ns.email('stranger'));

    const res = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: rawToken },
      bearer(stranger.token),
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiError).code).toBe('INVITE_EMAIL_MISMATCH');
  });

  it('404s on a bogus token and 410s on an expired invite', async () => {
    const admin = await signup(test.baseUrl, ns.email('chief'));
    const user = await signup(test.baseUrl, ns.email('joiner'));

    const bogus = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: 'bogus-token' },
      bearer(user.token),
    );
    expect(bogus.status).toBe(404);
    expect(((await bogus.json()) as ApiError).code).toBe('INVITE_NOT_FOUND');

    const expiredEmail = ns.email('late');
    const { rawToken } = await inviteAndGetToken(admin.token, expiredEmail);
    await test.db.query(
      `UPDATE org_invite SET expires_at = now() - interval '1 second' WHERE email = $1`,
      [expiredEmail],
    );
    const lateUser = await signup(test.baseUrl, expiredEmail);
    const expired = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: rawToken },
      bearer(lateUser.token),
    );
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as ApiError).code).toBe('INVITE_EXPIRED');
  });

  it('re-inviting replaces the pending invite; only the newest token works', async () => {
    const admin = await signup(test.baseUrl, ns.email('lead'));
    const email = ns.email('reinvited');

    const first = await inviteAndGetToken(admin.token, email);
    const second = await inviteAndGetToken(admin.token, email);
    const user = await signup(test.baseUrl, email);

    const oldTry = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: first.rawToken },
      bearer(user.token),
    );
    expect(oldTry.status).toBe(404);

    const newTry = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: second.rawToken },
      bearer(user.token),
    );
    expect(newTry.status).toBe(200);
  });

  it('409s when the invitee is already a member and 400s on a bad role', async () => {
    const admin = await signup(test.baseUrl, ns.email('solo'));

    const duplicate = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email: admin.user.email, role: 'interviewer' },
      bearer(admin.token),
    );
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as ApiError).code).toBe('ALREADY_MEMBER');

    const badRole = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email: ns.email('whatever'), role: 'owner' },
      bearer(admin.token),
    );
    expect(badRole.status).toBe(400);
  });
});
