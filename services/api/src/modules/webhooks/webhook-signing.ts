import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 request signing, Stripe-style.
 *
 * Header value: `t={unixSeconds},v1={hmac_sha256(secret, "{t}.{rawBody}")}`
 * Verification recomputes the HMAC and compares in constant time.
 */

export function signWebhookBody(
  secret: string,
  rawBody: string,
  timestampSeconds: number,
): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  header: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const [key = '', value = ''] = part.split('=', 2);
      return [key.trim(), value.trim()];
    }),
  );
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');
  return (
    expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

/** Retry schedule after a failed attempt N (1-based). 5 attempts then failed. */
export const MAX_DELIVERY_ATTEMPTS = 5;

export function backoffDelayMs(attempt: number): number {
  const schedule = (
    process.env.WEBHOOK_BACKOFF_MS ?? '60000,300000,1800000,7200000,43200000'
  )
    .split(',')
    .map((v) => Number(v.trim()));
  return schedule[Math.min(Math.max(attempt, 1), schedule.length) - 1] ?? 60_000;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}
