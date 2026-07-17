import { PinoLogger } from 'nestjs-pino';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from './email-sender.port';

/**
 * Local dev/test adapter (ADR-0002 mock-credential mode): plain SMTP to the
 * Mailpit container. Mailpit catches everything, so OTPs and invites are
 * observable via its HTTP API without real credentials.
 */
export class MailpitEmailAdapter implements EmailSender {
  private readonly transporter: Transporter;

  constructor(
    private readonly logger: PinoLogger,
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.logger.setContext(MailpitEmailAdapter.name);
    this.transporter = createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.info({ to: message.to, subject: message.subject }, 'email sent');
  }
}
