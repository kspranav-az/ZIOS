import { Injectable } from '@nestjs/common';
import { type EmailMessage, type EmailSender } from './email-sender.port';
import { type OtpSender } from './otp-sender.port';

/**
 * Local dev/test adapter for candidate OTPs (ADR-0002 mock-credential mode):
 * reuses the EmailSender port to deliver the 6-digit code via Mailpit.
 */
@Injectable()
export class MailpitOtpAdapter implements OtpSender {
  constructor(private readonly email: EmailSender) {}

  async send(to: string, code: string): Promise<void> {
    const message: EmailMessage = {
      to,
      subject: 'Your InterviewOS verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
    };
    await this.email.send(message);
  }
}
