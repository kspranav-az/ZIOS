import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { EMAIL_SENDER, type EmailSender } from './email-sender.port';
import { MailpitEmailAdapter } from './mailpit-email.adapter';
import { MailpitOtpAdapter } from './mailpit-otp.adapter';
import { OTP_SENDER } from './otp-sender.port';

const DEFAULT_FROM = 'InterviewOS <no-reply@interviewos.local>';

/**
 * Binds the EmailSender and OtpSender ports to local Mailpit adapters.
 * Real providers slot in at their scheduled phases without call-site changes.
 */
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger): EmailSender => {
        const adapter = process.env.EMAIL_ADAPTER ?? 'mailpit';
        switch (adapter) {
          case 'mailpit':
            return new MailpitEmailAdapter(
              logger,
              process.env.SMTP_URL ?? 'smtp://localhost:1025',
              process.env.MAIL_FROM ?? DEFAULT_FROM,
            );
          default:
            throw new Error(`EMAIL_ADAPTER='${adapter}' is not a known email adapter`);
        }
      },
    },
    {
      provide: OTP_SENDER,
      inject: [EMAIL_SENDER],
      useFactory: (email: EmailSender): MailpitOtpAdapter => new MailpitOtpAdapter(email),
    },
  ],
  exports: [EMAIL_SENDER, OTP_SENDER],
})
export class NotificationsModule {}
