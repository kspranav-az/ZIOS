/** Tunables for the email+OTP sign-in flow and sessions (FR-E1-1). */
export const OTP_TTL_SECONDS = 600; // 10-minute code expiry
export const OTP_MAX_ATTEMPTS = 5; // wrong-code tries before the code is dead
export const OTP_RESEND_COOLDOWN_SECONDS = 60; // min wait between two issues

export const SESSION_TTL_DAYS = 30; // sliding: every authenticated request re-extends
export const SESSION_COOKIE = 'zios_session';
