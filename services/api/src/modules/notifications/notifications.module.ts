import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { EMAIL_SENDER, type EmailSender } from './email-sender.port';
import { MailpitEmailAdapter } from './mailpit-email.adapter';

const DEFAULT_FROM = 'InterviewOS <no-reply@interviewos.local>';

/**
 * Binds the EmailSender port to an adapter selected by EMAIL_ADAPTER
 * ('mailpit' is the only adapter until a real provider's phase arrives).
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
  ],
  exports: [EMAIL_SENDER],
})
export class NotificationsModule {}
