import { describe, expect, it } from 'vitest';
import { TokenService } from './tokens';

describe('TokenService', () => {
  it('generates 128-bit raw tokens (16 bytes)', () => {
    const token = TokenService.generateRaw();
    expect(Buffer.from(token, 'base64url').length).toBe(16);
  });

  it('produces unique raw tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => TokenService.generateRaw()));
    expect(tokens.size).toBe(100);
  });

  it('stores SHA-256 hashes, not the raw token', () => {
    const raw = TokenService.generateRaw();
    const hash = TokenService.hash(raw);
    expect(hash).not.toBe(raw);
    expect(hash.length).toBeGreaterThan(0);
  });

  it('hashes are deterministic but different for different tokens', () => {
    const a = TokenService.generateRaw();
    const b = TokenService.generateRaw();
    expect(TokenService.hash(a)).toBe(TokenService.hash(a));
    expect(TokenService.hash(a)).not.toBe(TokenService.hash(b));
  });
});
