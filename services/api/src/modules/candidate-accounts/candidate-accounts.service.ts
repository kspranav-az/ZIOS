import { Injectable } from '@nestjs/common';
import type {
  CandidateAccount,
  CandidateAuthResponse,
  CandidateCompanyHistoryItem,
  CandidateMePatchBody,
  CandidateWalletResponse,
  CandOtpRequestResponse,
} from '@zios/shared-types';
import { OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS, OtpService } from '@/modules/auth';
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
        await this.credits.credit(accountId, CANDIDATE_WELCOME_GRANT_CREDITS, 'welcome_grant', q, {
          metadata: { product: 'ascend' },
        });
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

  /**
   * Company interviews linked to this account (Phase 12e). Link maintenance
   * is lazy — each read first links any employer-side candidate rows whose
   * email exactly matches the account's (citext comparison: case-insensitive,
   * never fuzzy), so links appear without touching the invites module.
   * Composed with practice progress by the history module's read model.
   */
  async getCompanyHistory(accountId: string): Promise<CandidateCompanyHistoryItem[]> {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw new ApiException(404, 'ACCOUNT_NOT_FOUND', 'candidate account not found');
    }

    // The $2::citext cast matters: node-pg types plain parameters as text,
    // and `citext = text` downcasts to a case-SENSITIVE text comparison —
    // the exact-email link would silently miss any case difference.
    await this.db.query(
      `UPDATE candidate
       SET candidate_account_id = $1
       WHERE candidate_account_id IS NULL AND email = $2::citext`,
      [accountId, account.email],
    );

    const company = await this.db.query(
      `SELECT s.id AS session_id, o.name AS org_name,
              COALESCE(k.role, k.title) AS role_title,
              s.mode, s.status, s.started_at, s.ended_at
       FROM candidate c
       JOIN invite i ON i.candidate_id = c.id
       JOIN interview_session s ON s.invite_id = i.id
       JOIN kit_version kv ON kv.id = s.kit_version_id
       JOIN kit k ON k.id = kv.kit_id
       JOIN org o ON o.id = c.org_id
       WHERE c.candidate_account_id = $1
       ORDER BY s.created_at DESC`,
      [accountId],
    );

    return company.rows.map((row) => ({
      sessionId: row.session_id as string,
      orgName: row.org_name as string,
      roleTitle: (row.role_title as string | null) ?? null,
      mode: row.mode as string,
      status: row.status as string,
      startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
      completedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
      reportAvailable: false,
    }));
  }

  /** Thin wallet view (M2): candidate credit account balance + alert line + ledger. */
  async getWallet(accountId: string): Promise<CandidateWalletResponse> {
    const accountIdResolved = await this.credits.ensureAccount('candidate', accountId);
    const account = await this.credits.getAccount(accountIdResolved);
    const ledger = await this.credits.listLedger(accountIdResolved, 50);
    return {
      balance: account.balance,
      lowBalanceThreshold: account.lowBalanceThreshold,
      ledger: ledger.map((e) => ({
        id: e.id,
        delta: e.delta,
        balanceAfter: e.balanceAfter,
        reason: e.reason,
        createdAt: e.createdAt,
      })),
    };
  }

  async patchMe(
    accountId: string,
    body: CandidateMePatchBody,
  ): Promise<{ account: CandidateAccount }> {
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'name must be a non-empty string');
    }
    if (
      body.targetRole !== undefined &&
      body.targetRole !== null &&
      typeof body.targetRole !== 'string'
    ) {
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
