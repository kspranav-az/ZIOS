import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CandidateSessionInfo } from '@zios/shared-types';
import type { Queryable } from '@/modules/database';
import { SESSION_TTL_DAYS } from '@/modules/auth';
import {
  CandidateSessionRepository,
  type CandidateSessionWithAccount,
} from './candidate-session.repository';

const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Candidate session tokens (Phase 12, D8): same opaque-hashed design as the
 * employer session, but in a separate table — an employer token can never
 * resolve here and vice versa (audience separation by construction).
 */
@Injectable()
export class CandidateSessionService {
  constructor(private readonly sessions: CandidateSessionRepository) {}

  async create(accountId: string, q: Queryable): Promise<CandidateSessionInfo> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);
    await this.sessions.insert({ accountId, tokenHash: hashToken(token), expiresAt }, q);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Resolves a raw token, sliding the expiry forward. Null when invalid. */
  async resolve(rawToken: string): Promise<CandidateSessionWithAccount | null> {
    const session = await this.sessions.findActiveWithAccount(hashToken(rawToken));
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
}
