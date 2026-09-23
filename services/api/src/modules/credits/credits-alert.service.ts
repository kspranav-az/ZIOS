import { Inject, Injectable, Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';
import { DatabaseService } from '@/modules/database';
import { EMAIL_SENDER, type EmailSender } from '@/modules/notifications';
import { CreditsService } from './credits.service';

const WATERMARK_TTL_SECONDS = 86_400; // 1 email per account per 24h

/**
 * Low-balance alerts (FR-E14-3): after a debit drops the account balance
 * below the holder's threshold, notify the holder — org admins for org
 * accounts, the candidate's own email for candidate accounts — but at most
 * once per 24h (redis watermark, best-effort). Alerting never blocks the
 * debit path: every failure is logged and swallowed.
 */
@Injectable()
export class CreditsAlertService {
  private readonly logger = new Logger(CreditsAlertService.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly credits: CreditsService,
    private readonly db: DatabaseService,
  ) {}

  async maybeAlertLowBalance(accountId: string, balanceAfter: number): Promise<void> {
    try {
      const account = await this.credits.getAccount(accountId);
      if (balanceAfter >= account.lowBalanceThreshold) return;

      const key = `lowbal:${accountId}`;
      const acquired = await this.redis.set(key, String(balanceAfter), 'EX', WATERMARK_TTL_SECONDS, 'NX');
      if (acquired !== 'OK') return;

      if (account.holderType === 'candidate') {
        // Candidate accounts: email lives in candidate_account (queried
        // directly to avoid a CreditsModule ↔ CandidateAccountsModule cycle).
        const candidates = await this.db.query(
          `SELECT email FROM candidate_account WHERE id = $1`,
          [account.holderId],
        );
        const to = (candidates.rows[0] as { email: string } | undefined)?.email;
        if (!to) {
          this.logger.warn(
            `low-balance alert for candidate account ${accountId} skipped: no candidate_account row`,
          );
          return;
        }
        await this.email.send({
          to,
          subject: 'Ascend: your practice credits are running low',
          text:
            `Your Ascend practice credit balance is ${balanceAfter}, below the ` +
            `alert threshold of ${account.lowBalanceThreshold}. Mocks may fail to start ` +
            `once the balance reaches zero. During the closed beta, reply to this email ` +
            `and we will top you up.\n\n` +
            `(This alert is sent at most once per 24 hours.)`,
        });
        return;
      }

      const admins = await this.db.query(
        `SELECT email FROM app_user WHERE org_id = $1 AND role = 'admin' ORDER BY created_at ASC`,
        [account.holderId],
      );
      for (const row of admins.rows as { email: string }[]) {
        await this.email.send({
          to: row.email,
          subject: 'Zios: interview credit balance is low',
          text:
            `Your organization's interview credit balance is ${balanceAfter}, below the ` +
            `alert threshold of ${account.lowBalanceThreshold}. New interviews may fail to start ` +
            `once the balance reaches zero. Top up credits to avoid interruption.\n\n` +
            `(This alert is sent at most once per 24 hours.)`,
        });
      }
    } catch (error) {
      this.logger.warn(
        `low-balance alert failed for ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
