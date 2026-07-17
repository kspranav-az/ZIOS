import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from './preview-tokens';

const SECRET = 'test-secret';

describe('preview tokens', () => {
  it('round-trips a signed token', () => {
    const { token, expiresAt } = signPreviewToken('kit-1', 'org-1', SECRET, 1_000);
    const result = verifyPreviewToken(token, SECRET, 1_000);
    expect(result).toEqual({
      ok: true,
      payload: { v: 1, kitId: 'kit-1', orgId: 'org-1', exp: 1_000 + 1800 },
    });
    expect(new Date(expiresAt).getTime()).toBe((1_000 + 1800) * 1000);
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = signPreviewToken('kit-1', 'org-1', SECRET, 1_000);
    expect(verifyPreviewToken(token, 'other-secret', 1_000)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects tampered payloads', () => {
    const { token } = signPreviewToken('kit-1', 'org-1', SECRET, 1_000);
    const [body, signature] = token.split('.');
    const forged = `${Buffer.from(
      JSON.stringify({ v: 1, kitId: 'kit-2', orgId: 'org-1', exp: 9_999_999 }),
    ).toString('base64url')}.${signature}`;
    expect(verifyPreviewToken(forged, SECRET, 1_000).ok).toBe(false);
    expect(verifyPreviewToken(`${body}x.${signature}`, SECRET, 1_000).ok).toBe(false);
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'abc', 'abc.', '.def', 'not-a-token.at-all.really']) {
      expect(verifyPreviewToken(bad, SECRET, 1_000).ok).toBe(false);
    }
  });

  it('rejects structurally invalid payloads even with a valid signature', () => {
    const body = Buffer.from(JSON.stringify({ v: 2 })).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(body).digest('base64url');
    expect(verifyPreviewToken(`${body}.${signature}`, SECRET, 1_000)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('distinguishes expired from invalid', () => {
    const { token } = signPreviewToken('kit-1', 'org-1', SECRET, 1_000);
    expect(verifyPreviewToken(token, SECRET, 1_000 + 1800)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verifyPreviewToken(token, SECRET, 1_000 + 1799).ok).toBe(true);
  });
});
