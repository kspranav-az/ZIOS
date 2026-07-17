import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '@/modules/database';
import { RemindersService } from './reminders.service';

/**
 * Background reminder job (FR-E5-3). Runs every hour and sends T-48h/T-4h
 * reminder emails to candidates with pending invites.
 */
@Injectable()
export class RemindersCron {
  constructor(
    private readonly db: DatabaseService,
    private readonly reminders: RemindersService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.db.transaction((q) => this.reminders.sendDueReminders(q));
  }
}
