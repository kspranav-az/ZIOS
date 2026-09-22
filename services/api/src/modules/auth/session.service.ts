import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AuthSessionInfo } from '@zios/shared-types';
import { SESSION_TTL_DAYS } from './auth.constants';
import { SessionRepository, type SessionWithUser } from './session.repository';

const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Opaque session tokens: 32 crypto-random bytes, base64url-encoded for
 * transport; only the sha256 hash is stored. Expiry is 30d sliding.
 */
@Injectable()
export class SessionService {
  constructor(private readonly sessions: SessionRepository) {}

  async create(userId: string): Promise<AuthSessionInfo> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    await this.sessions.insert({ userId, tokenHash: hashToken(token), expiresAt });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Resolves a raw token to its session + user, sliding the expiry forward.
   * Returns null for unknown, revoked, or expired tokens.
   */
  async resolve(rawToken: string): Promise<SessionWithUser | null> {
    const session = await this.sessions.findActiveWithUser(hashToken(rawToken));
    if (!session || session.sessionExpiresAt.getTime() <= Date.now()) {
      return null;
    }
    const expiresAt = new Date(Date.now() + TTL_MS);
    await this.sessions.touch(session.sessionId, expiresAt);
    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  /**
   * Read-only presence check (no sliding touch). Used by CandidateAuthGuard
   * to distinguish employer tokens (403 audience violation) from garbage
   * (401) on candidate routes.
   */
  async isActiveToken(rawToken: string): Promise<boolean> {
    const session = await this.sessions.findActiveWithUser(hashToken(rawToken));
    return session !== null && session.sessionExpiresAt.getTime() > Date.now();
  }
}
