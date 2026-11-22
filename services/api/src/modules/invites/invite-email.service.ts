import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_SENDER, type EmailSender } from '@/modules/notifications';

/**
 * Invite delivery email (plans/employer-invite-ui-and-email.md, D5): the
 * candidate's entry link is emailed on single create (default on), reissue
 * (always), and every successful bulk row. Sent AFTER the transaction
 * commits — never inside — and always non-fatal: a down email adapter must
 * never block an invite, because the API response still carries the link.
 */

export interface InviteEmailInput {
  to: string;
  candidateName: string;
  kitTitle: string;
  token: string;
  expiresAt: string;
}

function candidateBaseUrl(): string {
  return process.env.PUBLIC_CANDIDATE_BASE_URL ?? 'http://localhost:5174';
}

@Injectable()
export class InviteEmailService {
  private readonly logger = new Logger(InviteEmailService.name);

  constructor(@Inject(EMAIL_SENDER) private readonly email: EmailSender) {}

  async sendInviteEmail(input: InviteEmailInput): Promise<void> {
    const link = `${candidateBaseUrl()}/?token=${encodeURIComponent(input.token)}`;
    const expiry = new Date(input.expiresAt).toLocaleDateString('en-US', { dateStyle: 'long' });
    const subject = input.kitTitle
      ? `Your interview — ${input.kitTitle}`
      : 'Your interview invitation';

    await this.email.send({
      to: input.to,
      subject,
      text: [
        `Hi ${input.candidateName},`,
        '',
        `You've been invited to an interview${input.kitTitle ? ` for ${input.kitTitle}` : ''}.`,
        '',
        `Open your interview: ${link}`,
        '',
        `This link is private to you and expires on ${expiry}.`,
        'Please complete it before then — it only takes a few minutes.',
        '',
        'Good luck!',
      ].join('\n'),
    });
  }

  /** Fire-and-forget wrapper — logs and swallows failures. */
  sendSafely(input: InviteEmailInput): void {
    void this.sendInviteEmail(input).catch((err: unknown) => {
      this.logger.warn(
        `invite email to ${input.to} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
