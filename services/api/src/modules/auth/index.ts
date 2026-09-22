// Public contract of the auth module. Everything outside this module must
// import from '@/modules/auth' (this file) — never from sibling files.
export { AuthModule } from './auth.module';

export { OtpService } from './otp.service';
export { OtpRepository, type OtpAudience, type OtpRow } from './otp.repository';
export { SessionService } from './session.service';
export {
  OTP_TTL_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
  SESSION_TTL_DAYS,
} from './auth.constants';
