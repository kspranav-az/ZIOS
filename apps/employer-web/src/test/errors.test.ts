import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { retryAfterSeconds, userMessageForError } from '../lib/errors';

describe('error mapping', () => {
  it('maps OTP_COOLDOWN and surfaces retryAfterSeconds', () => {
    const error = new ApiRequestError(429, 'OTP_COOLDOWN', 'slow down', { retryAfterSeconds: 42 });
    expect(userMessageForError(error)).toMatch(/wait/i);
    expect(retryAfterSeconds(error)).toBe(42);
  });

  it('maps INVALID_OTP to a retry hint', () => {
    const error = new ApiRequestError(400, 'INVALID_OTP', 'nope');
    expect(userMessageForError(error)).toMatch(/doesn't match/i);
  });

  it('maps OTP_EXPIRED to a request-new-code hint', () => {
    const error = new ApiRequestError(400, 'OTP_EXPIRED', 'expired');
    expect(userMessageForError(error)).toMatch(/expired/i);
  });

  it('maps OTP_ATTEMPTS_EXCEEDED', () => {
    const error = new ApiRequestError(429, 'OTP_ATTEMPTS_EXCEEDED', 'locked');
    expect(userMessageForError(error)).toMatch(/too many/i);
  });

  it('maps INVITE_EMAIL_MISMATCH to a sign-in-with-invited-email hint', () => {
    const error = new ApiRequestError(403, 'INVITE_EMAIL_MISMATCH', 'mismatch');
    expect(userMessageForError(error)).toMatch(/different email address/i);
  });

  it('maps INVITE_NOT_FOUND / INVITE_EXPIRED / ALREADY_MEMBER', () => {
    expect(userMessageForError(new ApiRequestError(404, 'INVITE_NOT_FOUND', 'x'))).toMatch(
      /invalid or has already been used/i,
    );
    expect(userMessageForError(new ApiRequestError(410, 'INVITE_EXPIRED', 'x'))).toMatch(
      /expired/i,
    );
    expect(userMessageForError(new ApiRequestError(409, 'ALREADY_MEMBER', 'x'))).toMatch(
      /already a member/i,
    );
  });

  it('maps NETWORK_ERROR without leaking internals', () => {
    const error = new ApiRequestError(0, 'NETWORK_ERROR', 'fetch failed');
    expect(userMessageForError(error)).toMatch(/could not reach the server/i);
  });

  it('falls back to the server message for unmapped codes', () => {
    const error = new ApiRequestError(500, 'SOMETHING_NEW', 'Server said what happened');
    expect(userMessageForError(error)).toBe('Server said what happened');
  });

  it('falls back to a generic message for non-api errors', () => {
    expect(userMessageForError(new Error('boom'))).toMatch(/something went wrong/i);
    expect(userMessageForError(undefined)).toMatch(/something went wrong/i);
  });

  it('returns null retryAfterSeconds for non-cooldown errors', () => {
    expect(retryAfterSeconds(new ApiRequestError(400, 'INVALID_OTP', 'x'))).toBeNull();
    expect(retryAfterSeconds(new Error('x'))).toBeNull();
  });
});
