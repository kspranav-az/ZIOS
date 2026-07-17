import { describe, expect, it, vi } from 'vitest';
import type { AppUser, Org } from '@zios/shared-types';
import type { DatabaseService } from '@/modules/database';
import type { EmailSender } from '@/modules/notifications';
import type { UsersService } from '@/modules/users';
import { InvitesRepository, type InviteRow } from './invites.repository';
import { InvitesService } from './invites.service';
import type { OrgRepository } from './org.repository';

const inviter: AppUser = {
  id: 'admin-1',
  orgId: 'org-1',
  email: 'admin@acme.com',
  name: 'Admin',
  role: 'admin',
  createdAt: new Date().toISOString(),
};

const invitingOrg: Org = {
  id: 'org-1',
  name: 'Acme',
  plan: 'pilot',
  creditsBalance: 0,
  createdAt: new Date().toISOString(),
};

function inviteRow(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'invite-1',
    org_id: 'org-1',
    email: 'teammate@acme.com',
    role: 'interviewer',
    token_hash: 'hash',
    invited_by: inviter.id,
    expires_at: new Date(Date.now() + 7 * 86_400_000),
    accepted_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

function makeService(options: { pendingInvite?: InviteRow | null; isMember?: boolean } = {}) {
  const invites = {
    deletePending: vi.fn(async () => {}),
    insert: vi.fn(async (_input: { tokenHash: string }) => inviteRow()),
    findPendingByTokenHash: vi.fn(async () => options.pendingInvite ?? null),
    markAccepted: vi.fn(async () => {}),
    deleteById: vi.fn(async () => {}),
  };
  const orgs = { findById: vi.fn(async () => invitingOrg) };
  const users = {
    emailBelongsToOrg: vi.fn(async () => options.isMember ?? false),
    moveToOrg: vi.fn(async (userId: string, orgId: string, role: AppUser['role']) => ({
      ...inviter,
      id: userId,
      orgId,
      role,
    })),
  };
  const db = {
    withTenant: vi.fn(async (fn: (q: unknown) => Promise<unknown>) => fn({})),
    transaction: vi.fn(async (fn: (q: unknown) => Promise<unknown>) => fn({})),
  };
  const email = {
    send: vi.fn(async (_message: { to: string; subject: string; text: string }) => {}),
  };
  const service = new InvitesService(
    db as unknown as DatabaseService,
    invites as unknown as InvitesRepository,
    orgs as unknown as OrgRepository,
    users as unknown as UsersService,
    email as unknown as EmailSender,
  );
  return { service, invites, orgs, users, email };
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, response: { statusCode: status, code } });
}

describe('InvitesService.create', () => {
  it('stores only the token hash and emails the raw token link', async () => {
    const { service, invites, email } = makeService();

    const invite = await service.create('org-1', inviter, {
      email: 'teammate@acme.com',
      role: 'interviewer',
    });

    expect(invites.deletePending).toHaveBeenCalledWith(
      'org-1',
      'teammate@acme.com',
      expect.anything(),
    );
    const inserted = invites.insert.mock.calls[0]?.[0] as { tokenHash: string };
    expect(inserted.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const mail = email.send.mock.calls[0]?.[0] as { to: string; text: string };
    expect(mail.to).toBe('teammate@acme.com');
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
    expect(token).toBeDefined();
    // The API response deliberately does NOT leak the raw token.
    expect(JSON.stringify(invite)).not.toContain(token as string);
    expect(invite.role).toBe('interviewer');
  });

  it('rejects invalid input', async () => {
    const { service } = makeService();
    await expectApiError(
      service.create('org-1', inviter, { email: 'nope', role: 'interviewer' }),
      400,
      'VALIDATION_ERROR',
    );
    await expectApiError(
      service.create('org-1', inviter, { email: 'a@b.co', role: 'superadmin' }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('409s when the email is already a member', async () => {
    const { service } = makeService({ isMember: true });
    await expectApiError(
      service.create('org-1', inviter, { email: 'teammate@acme.com', role: 'interviewer' }),
      409,
      'ALREADY_MEMBER',
    );
  });

  it('deletes the invite and 502s when the email cannot be delivered', async () => {
    const { service, invites, email } = makeService();
    email.send.mockRejectedValueOnce(new Error('smtp down'));
    await expectApiError(
      service.create('org-1', inviter, { email: 'teammate@acme.com', role: 'interviewer' }),
      502,
      'EMAIL_SEND_FAILED',
    );
    expect(invites.deleteById).toHaveBeenCalledWith('invite-1');
  });
});

describe('InvitesService.accept', () => {
  const acceptor: AppUser = { ...inviter, id: 'user-2', email: 'teammate@acme.com' };

  it('moves the user into the inviting org and marks the invite accepted', async () => {
    const { service, users, invites } = makeService({ pendingInvite: inviteRow() });

    const result = await service.accept('raw-token', acceptor);

    expect(users.moveToOrg).toHaveBeenCalledWith(
      'user-2',
      'org-1',
      'interviewer',
      expect.anything(),
    );
    expect(invites.markAccepted).toHaveBeenCalledWith('invite-1', expect.anything());
    expect(result.user.orgId).toBe('org-1');
    expect(result.user.role).toBe('interviewer');
    expect(result.org.id).toBe('org-1');
  });

  it('400s on a missing token', async () => {
    const { service } = makeService();
    await expectApiError(service.accept(undefined, acceptor), 400, 'VALIDATION_ERROR');
  });

  it('404s on an unknown or already-used token', async () => {
    const { service } = makeService({ pendingInvite: null });
    await expectApiError(service.accept('raw-token', acceptor), 404, 'INVITE_NOT_FOUND');
  });

  it('410s on an expired invite', async () => {
    const { service } = makeService({
      pendingInvite: inviteRow({ expires_at: new Date(Date.now() - 1000) }),
    });
    await expectApiError(service.accept('raw-token', acceptor), 410, 'INVITE_EXPIRED');
  });

  it('403s when the session email does not match the invite email', async () => {
    const { service, users } = makeService({ pendingInvite: inviteRow() });
    const stranger: AppUser = { ...inviter, id: 'user-3', email: 'stranger@acme.com' };

    await expectApiError(service.accept('raw-token', stranger), 403, 'INVITE_EMAIL_MISMATCH');
    expect(users.moveToOrg).not.toHaveBeenCalled();
  });
});
