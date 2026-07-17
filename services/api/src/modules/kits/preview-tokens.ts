/**
 * Preview-as-candidate tokens (FR-E2-6): short-lived (30 min) HMAC-signed
 * grants resolving to a read-only projection of a kit draft. Stateless — no
 * persistence rows are created by minting or resolving a token.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PREVIEW_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * Local-dev default keeps the compose stack and tests self-contained; set
 * PREVIEW_TOKEN_SECRET in any real deployment (documented in .env.example).
 */
export function previewTokenSecret(): string {
  return process.env.PREVIEW_TOKEN_SECRET ?? 'interviewos-dev-preview-secret';
}

export interface PreviewTokenPayload {
  v: 1;
  kitId: string;
  orgId: string;
  /** Expiry, unix seconds. */
  exp: number;
}

export type PreviewTokenVerification =
  { ok: true; payload: PreviewTokenPayload } | { ok: false; reason: 'invalid' | 'expired' };

export function signPreviewToken(
  kitId: string,
  orgId: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { token: string; expiresAt: string } {
  const payload: PreviewTokenPayload = {
    v: 1,
    kitId,
    orgId,
    exp: nowSec + PREVIEW_TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `${body}.${signature}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function verifyPreviewToken(
  token: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): PreviewTokenVerification {
  const invalid: PreviewTokenVerification = { ok: false, reason: 'invalid' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return invalid;
  }
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', secret).update(body).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return invalid;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return invalid;
  }
  const p = payload as Partial<PreviewTokenPayload> | null;
  if (
    p?.v !== 1 ||
    typeof p.kitId !== 'string' ||
    typeof p.orgId !== 'string' ||
    typeof p.exp !== 'number'
  ) {
    return invalid;
  }
  if (p.exp <= nowSec) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload: p as PreviewTokenPayload };
}
