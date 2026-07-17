import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_SENDER, type EmailSender } from '@/modules/notifications';
import type { Queryable } from '@/modules/database';
import type { Invite } from '@zios/shared-types';
import { InvitesRepository } from './invites.repository';

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET ?? 'local-unsubscribe-secret';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://localhost:5173';

interface PendingReminder extends Invite {
  candidateEmail: string;
  candidateName: string;
  reminder48hSentAt: string | null;
  reminder4hSentAt: string | null;
}

@Injectable()
export class RemindersService {
  constructor(
    private readonly invites: InvitesRepository,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  static unsubscribeToken(email: string): string {
    return createHmac('sha256', UNSUBSCRIBE_SECRET).update(email).digest('base64url');
  }

  static verifyUnsubscribeToken(email: string, token: string): boolean {
    return RemindersService.unsubscribeToken(email) === token;
  }

  private unsubscribeUrl(email: string): string {
    const token = RemindersService.unsubscribeToken(email);
    return `${WEB_BASE_URL}/invites/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  }

  private inviteUrl(): string {
    // Reminder emails do not store the raw token; the candidate uses the link
    // they already received. This landing page can ask them to paste it.
    return `${WEB_BASE_URL}/i/start`;
  }

  /** Returns the reminder window that is currently due for an invite, if any. */
  private dueWindow(invite: PendingReminder): '48h' | '4h' | null {
    const expiresAt = new Date(invite.expiresAt).getTime();
    const now = Date.now();
    const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);
    if (hoursUntilExpiry <= 0) return null;
    if (hoursUntilExpiry <= 4 && !invite.reminder4hSentAt) return '4h';
    if (hoursUntilExpiry <= 48 && !invite.reminder48hSentAt) return '48h';
    return null;
  }

  /** Queries pending invites and their candidate emails. */
  async findPendingReminders(q: Queryable): Promise<PendingReminder[]> {
    const invites = await this.invites.findPendingForReminders(q);
    return invites.filter((invite) => this.dueWindow(invite) !== null);
  }

  /** Sends all due reminders. Idempotent: marks after successful send. */
  async sendDueReminders(q: Queryable): Promise<{ sent: number }> {
    const pending = await this.findPendingReminders(q);
    let sent = 0;
    for (const invite of pending) {
      const window = this.dueWindow(invite);
      if (!window) continue;
      const subject =
        window === '48h'
          ? 'Reminder: your interview link expires in 48 hours'
          : 'Final reminder: your interview link expires in 4 hours';
      const text = [
        `Hi ${invite.candidateName},`,
        '',
        `Your interview link will expire soon. Please complete your interview at:`,
        this.inviteUrl(),
        '',
        `You can unsubscribe from reminders here: ${this.unsubscribeUrl(invite.candidateEmail)}`,
      ].join('\n');
      await this.email.send({ to: invite.candidateEmail, subject, text });
      await this.invites.setReminderSent(invite.id, window, q);
      sent += 1;
    }
    return { sent };
  }
}
