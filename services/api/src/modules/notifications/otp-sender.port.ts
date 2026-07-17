/**
 * OtpSender port (ADR-0002): the only surface feature code may depend on for
 * delivering one-time passcodes to candidates. The adapter is bound by config,
 * so a real WhatsApp/SMS provider slots in at its scheduled phase without
 * touching call sites.
 */
export interface OtpSender {
  send(to: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');
