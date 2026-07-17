import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppUser, AppUserRole, Org, OrgInvite } from '@zios/shared-types';
import { ApiException, assertValidEmail } from '@/common/errors';
import { DatabaseService } from '@/modules/database';
import { EMAIL_SENDER, type EmailSender } from '@/modules/notifications';
import { UsersService } from '@/modules/users';
import { InvitesRepository, mapInviteRow } from './invites.repository';
import { OrgRepository } from './org.repository';

export const INVITE_TTL_DAYS = 7;

const ROLES: readonly AppUserRole[] = ['admin', 'interviewer'];

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly invites: InvitesRepository,
    private readonly orgs: OrgRepository,
    private readonly users: UsersService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  /**
   * FR-E1-3: admin invites a teammate by email. The raw token is only ever
   * sent to the invitee's inbox; the API response carries no token.
   */
  async create(
    orgId: string,
    inviter: AppUser,
    input: { email: string; role: string },
  ): Promise<OrgInvite> {
    assertValidEmail(input?.email);
    const email = input.email.trim();
    const role = input?.role as AppUserRole;
    if (!ROLES.includes(role)) {
      throw new ApiException(400, 'VALIDATION_ERROR', "role must be 'admin' or 'interviewer'");
    }
    if (await this.users.emailBelongsToOrg(orgId, email)) {
      throw new ApiException(409, 'ALREADY_MEMBER', 'this email is already a member of the org');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const row = await this.db.withTenant(async (client) => {
      await this.invites.deletePending(orgId, email, client);
      return this.invites.insert(
        {
          orgId,
          email,
          role,
          tokenHash: hashToken(rawToken),
          invitedBy: inviter.id,
          expiresAt,
        },
        client,
      );
    });

    try {
      await this.email.send(this.buildInviteEmail(inviter, email, role, rawToken));
    } catch {
      await this.invites.deleteById(row.id);
      throw new ApiException(502, 'EMAIL_SEND_FAILED', 'could not deliver the invite email');
    }
    return mapInviteRow(row);
  }

  /**
   * Accept requires an authenticated session whose email matches the invite —
   * the link alone is not sufficient (the invitee proves inbox ownership via
   * OTP first). The user is moved into the inviting org with the invited role.
   */
  async accept(rawToken: unknown, user: AppUser): Promise<{ user: AppUser; org: Org }> {
    if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'invite token is required');
    }
    const invite = await this.invites.findPendingByTokenHash(hashToken(rawToken.trim()));
    if (!invite) {
      throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite token is invalid or already used');
    }
    if (invite.expires_at.getTime() <= Date.now()) {
      throw new ApiException(410, 'INVITE_EXPIRED', 'invite has expired — ask for a new one');
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ApiException(
        403,
        'INVITE_EMAIL_MISMATCH',
        'this invite was issued to a different email address',
      );
    }

    const updatedUser = await this.db.transaction(async (client) => {
      const moved = await this.users.moveToOrg(user.id, invite.org_id, invite.role, client);
      await this.invites.markAccepted(invite.id, client);
      return moved;
    });
    const org = await this.orgs.findById(invite.org_id);
    if (!org) {
      throw new ApiException(500, 'ORG_MISSING', 'inviting org no longer exists');
    }
    return { user: updatedUser, org };
  }

  private buildInviteEmail(inviter: AppUser, to: string, role: AppUserRole, rawToken: string) {
    const webBaseUrl = (process.env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const acceptUrl = `${webBaseUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
    return {
      to,
      subject: `${inviter.name} invited you to InterviewOS`,
      text: [
        `${inviter.name} (${inviter.email}) invited you to join their organization on InterviewOS as ${role}.`,
        '',
        `Accept the invite: ${acceptUrl}`,
        '',
        `This link expires in ${INVITE_TTL_DAYS} days. New here? The link takes you through a quick email sign-in first.`,
      ].join('\n'),
    };
  }
}
