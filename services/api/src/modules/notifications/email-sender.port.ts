/**
 * EmailSender port (ADR-0002): the only surface feature code may depend on
 * for outbound email. The adapter is bound by config (EMAIL_ADAPTER), so a
 * real transactional provider slots in at its scheduled phase without
 * touching call sites. No feature code names a vendor.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
