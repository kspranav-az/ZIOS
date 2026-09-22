import { Injectable } from '@nestjs/common';
import type {
  CandidateAccount,
  CandidateAuthResponse,
  CandidateMePatchBody,
  CandOtpRequestResponse,
} from '@zios/shared-types';
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  OtpService,
} from '@/modules/auth';
import { CreditsService } from '@/modules/credits';
import { DatabaseService } from '@/modules/database';
import { ApiException } from '@/common/errors';
import { CandidateAccountRepository } from './candidate-account.repository';
import { CandidateSessionService } from './candidate-session.service';

/** Closed-beta welcome grant for new candidate accounts (D-CONFIRM: 50). */
export const CANDIDATE_WELCOME_GRANT_CREDITS = 50;

@Injectable()
export class CandidateAccountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly otps: OtpService,
    private readonly accounts: CandidateAccountRepository,
    private readonly sessions: CandidateSessionService,
    private readonly credits: CreditsService,
  ) {}

  async requestOtp(email: unknown): Promise<CandOtpRequestResponse> {
    await this.otps.issue(email, 'candidate');
    return {
      ok: true,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAvailableInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  /**
   * Verifies the candidate-audience code, then signs the email in. A
   * never-seen email provisions a candidate account atomically, including
   * the welcome credit grant (ASC-1) on the holder-typed wallet.
   */
  async verifyOtp(email: unknown, code: unknown): Promise<CandidateAuthResponse> {
    await this.otps.verify(email, code, 'candidate');
    const normalizedEmail = (email as string).trim();

    return this.db.transaction(async (q) => {
      let account = await this.accounts.findByEmail(normalizedEmail, q);
      let isNewUser = false;
      if (!account) {
        account = await this.accounts.insert(normalizedEmail, q);
        isNewUser = true;
        const accountId = await this.credits.ensureAccount('candidate', account.id, q);
        await this.credits.credit(
          accountId,
          CANDIDATE_WELCOME_GRANT_CREDITS,
          'welcome_grant',
          q,
          { metadata: { product: 'ascend' } },
        );
      }
      await this.accounts.touchLastLogin(account.id, q);
      const session = await this.sessions.create(account.id, q);
      return { session, isNewUser, account };
    });
  }

  async getMe(accountId: string): Promise<{ account: CandidateAccount }> {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw new ApiException(404, 'ACCOUNT_NOT_FOUND', 'candidate account not found');
    }
    return { account };
  }

  async patchMe(accountId: string, body: CandidateMePatchBody): Promise<{ account: CandidateAccount }> {
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'name must be a non-empty string');
    }
    if (body.targetRole !== undefined && body.targetRole !== null && typeof body.targetRole !== 'string') {
      throw new ApiException(400, 'VALIDATION_ERROR', 'targetRole must be a string');
    }
    const account = await this.accounts.updateProfile(accountId, {
      name: body.name?.trim(),
      targetRole: body.targetRole,
      marketingOptIn: body.marketingOptIn,
    });
    if (!account) {
      throw new ApiException(404, 'ACCOUNT_NOT_FOUND', 'candidate account not found');
    }
    return { account };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
