import { Inject, Injectable, Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';
import { DatabaseService } from '@/modules/database';
import { EMAIL_SENDER, type EmailSender } from '@/modules/notifications';
import { OrgRepository } from '@/modules/org';

const WATERMARK_TTL_SECONDS = 86_400; // 1 email per org per 24h

/**
 * Low-balance alerts (FR-E14-3): after a debit drops the balance below the
 * org's threshold, notify org admins — but at most once per 24h (redis
 * watermark, best-effort). Alerting never blocks the debit path: every
 * failure is logged and swallowed.
 */
@Injectable()
export class CreditsAlertService {
  private readonly logger = new Logger(CreditsAlertService.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly orgs: OrgRepository,
    private readonly db: DatabaseService,
  ) {}

  async maybeAlertLowBalance(orgId: string, balanceAfter: number): Promise<void> {
    try {
      const org = await this.orgs.findById(orgId);
      if (!org) return;
      if (balanceAfter >= org.lowBalanceThreshold) return;

      const key = `lowbal:${orgId}`;
      const acquired = await this.redis.set(key, String(balanceAfter), 'EX', WATERMARK_TTL_SECONDS, 'NX');
      if (acquired !== 'OK') return;

      const admins = await this.db.query(
        `SELECT email FROM app_user WHERE org_id = $1 AND role = 'admin' ORDER BY created_at ASC`,
        [orgId],
      );
      for (const row of admins.rows as { email: string }[]) {
        await this.email.send({
          to: row.email,
          subject: 'Zios: interview credit balance is low',
          text:
            `Your organization's interview credit balance is ${balanceAfter}, below the ` +
            `alert threshold of ${org.lowBalanceThreshold}. New interviews may fail to start ` +
            `once the balance reaches zero. Top up credits to avoid interruption.\n\n` +
            `(This alert is sent at most once per 24 hours.)`,
        });
      }
    } catch (error) {
      this.logger.warn(
        `low-balance alert failed for ${orgId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
