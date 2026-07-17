import { Injectable } from '@nestjs/common';
import type {
  AppUser,
  AuthResponse,
  MeResponse,
  OtpRequestResponse,
  Org,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { OrgService } from '@/modules/org';
import { UsersService } from '@/modules/users';
import { OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS } from './auth.constants';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    private readonly orgs: OrgService,
  ) {}

  async requestOtp(email: unknown): Promise<OtpRequestResponse> {
    await this.otp.issue(email);
    return {
      ok: true,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAvailableInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  /**
   * Verifies the code, then signs the email in. A never-seen email triggers
   * first-login provisioning: new org (plan 'pilot') + the user as its admin.
   */
  async verifyOtp(email: unknown, code: unknown): Promise<AuthResponse> {
    await this.otp.verify(email, code);
    const normalizedEmail = (email as string).trim();
    return this.signInOrProvision(normalizedEmail);
  }

  async oauthSignIn(email: string, _provider: string): Promise<AuthResponse> {
    return this.signInOrProvision(email.trim());
  }

  private async signInOrProvision(normalizedEmail: string): Promise<AuthResponse> {
    let isNewUser = false;
    let user = await this.users.findByEmail(normalizedEmail);
    let org: Org;
    if (!user) {
      const provisioned = await this.orgs.provisionSignup(normalizedEmail);
      user = provisioned.user;
      org = provisioned.org;
      isNewUser = true;
    } else {
      org = await this.requireOrg(user.orgId);
    }

    const session = await this.sessions.create(user.id);
    return { session, isNewUser, user, org };
  }

  async me(user: AppUser): Promise<MeResponse> {
    return { user, org: await this.requireOrg(user.orgId) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  private async requireOrg(orgId: string): Promise<Org> {
    const org = await this.orgs.findById(orgId);
    if (!org) {
      throw new ApiException(500, 'ORG_MISSING', 'the user org no longer exists');
    }
    return org;
  }
}
