// Public contract of the notifications module. Everything outside this module
// must import from '@/modules/notifications' (this file) — never internals.
export { NotificationsModule } from './notifications.module';
export { EMAIL_SENDER, type EmailMessage, type EmailSender } from './email-sender.port';
export { OTP_SENDER, type OtpSender } from './otp-sender.port';
