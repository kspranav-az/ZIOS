import { ApiRequestError } from './api';

/**
 * Maps api error codes (services/api auth README "Errors" section) to
 * user-facing copy. Unknown codes fall back to the server's own message.
 */
const ERROR_MESSAGES: Record<string, string> = {
  OTP_COOLDOWN: 'A code was just sent to that address. Please wait before requesting another.',
  INVALID_OTP: "That code doesn't match our email. Check the digits and try again.",
  OTP_EXPIRED: 'That code has expired. Request a new one below.',
  OTP_ATTEMPTS_EXCEEDED: 'Too many incorrect attempts. Request a new code to try again.',
  EMAIL_SEND_FAILED: 'We could not send the sign-in email. Please try again in a moment.',
  VALIDATION_ERROR: 'Some of the information entered is not valid. Check it and try again.',
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  FORBIDDEN_ROLE: 'You do not have permission to perform this action.',
  INVITE_NOT_FOUND: 'This invite link is invalid or has already been used.',
  INVITE_EXPIRED: 'This invite has expired. Ask an admin to send you a new one.',
  INVITE_EMAIL_MISMATCH:
    'This invite was sent to a different email address. Sign in with the invited email to accept it.',
  ALREADY_MEMBER: 'You are already a member of this organization.',
  ORG_MISSING: 'We could not find your organization. Please sign in again.',
  NETWORK_ERROR: 'Could not reach the server. Check your connection and try again.',
  UNKNOWN_ERROR: 'Something went wrong. Please try again.',
};

/** Reads `retryAfterSeconds` from an OTP_COOLDOWN error envelope, if present. */
export function retryAfterSeconds(error: unknown): number | null {
  if (error instanceof ApiRequestError && error.code === 'OTP_COOLDOWN') {
    const value = error.details.retryAfterSeconds;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.ceil(value);
  }
  return null;
}

/** Human-readable message for any thrown value; never exposes raw envelopes. */
export function userMessageForError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const mapped = ERROR_MESSAGES[error.code];
    if (mapped) return mapped;
    return error.message || ERROR_MESSAGES.UNKNOWN_ERROR!;
  }
  return ERROR_MESSAGES.UNKNOWN_ERROR!;
}
