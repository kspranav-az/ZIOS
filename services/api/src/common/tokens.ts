import { createHash, randomBytes } from 'node:crypto';

/**
 * Cryptographically-random 128-bit tokens, stored as SHA-256 hashes.
 * Raw tokens are URL-safe base64url strings delivered to candidates only.
 */
export class TokenService {
  static generateRaw(): string {
    return randomBytes(16).toString('base64url');
  }

  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('base64url');
  }
}
