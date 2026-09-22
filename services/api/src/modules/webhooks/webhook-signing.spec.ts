import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_DELIVERY_ATTEMPTS,
  backoffDelayMs,
  generateWebhookSecret,
  signWebhookBody,
  verifyWebhookSignature,
} from './webhook-signing';

describe('webhook signing', () => {
  afterEach(() => {
    delete process.env.WEBHOOK_BACKOFF_MS;
  });

  it('round-trips a valid signature', () => {
    const secret = generateWebhookSecret();
    const body = JSON.stringify({ event: 'interview.completed', data: { interview_id: 'x' } });
    const now = Math.floor(Date.now() / 1000);
    const header = signWebhookBody(secret, body, now);
    expect(verifyWebhookSignature(secret, body, header, now)).toBe(true);
  });

  it('rejects a tampered body, wrong secret, and stale timestamps', () => {
    const secret = generateWebhookSecret();
    const body = '{"event":"interview.completed"}';
    const now = Math.floor(Date.now() / 1000);
    const header = signWebhookBody(secret, body, now);

    expect(verifyWebhookSignature(secret, '{"event":"report.ready"}', header, now)).toBe(false);
    expect(verifyWebhookSignature(generateWebhookSecret(), body, header, now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, now + 400)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'garbage', now)).toBe(false);
  });

  it('generates secrets of at least 32 chars after the prefix', () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith('whsec_')).toBe(true);
    expect(secret.length).toBeGreaterThanOrEqual(32 + 6);
  });

  it('computes the 1m/5m/30m/2h/12h backoff schedule', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(5);
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(300_000);
    expect(backoffDelayMs(3)).toBe(1_800_000);
    expect(backoffDelayMs(4)).toBe(7_200_000);
    expect(backoffDelayMs(5)).toBe(43_200_000);
  });

  it('honours a WEBHOOK_BACKOFF_MS override (test hermeticity)', () => {
    process.env.WEBHOOK_BACKOFF_MS = '100,200,400';
    expect(backoffDelayMs(1)).toBe(100);
    expect(backoffDelayMs(3)).toBe(400);
    expect(backoffDelayMs(5)).toBe(400);
  });
});
