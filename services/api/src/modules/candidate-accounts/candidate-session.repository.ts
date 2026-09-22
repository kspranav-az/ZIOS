import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface CandidateSessionWithAccount {
  sessionId: string;
  accountId: string;
  sessionExpiresAt: Date;
}

@Injectable()
export class CandidateSessionRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: { accountId: string; tokenHash: string; expiresAt: Date },
    q: Queryable,
  ): Promise<void> {
    await q.query(
      `INSERT INTO candidate_session (account_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [input.accountId, input.tokenHash, input.expiresAt],
    );
  }

  async findActiveWithAccount(tokenHash: string): Promise<CandidateSessionWithAccount | null> {
    const result = await this.db.query(
      `SELECT id AS "sessionId", account_id AS "accountId", expires_at AS "sessionExpiresAt"
       FROM candidate_session
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
    return (result.rows[0] as CandidateSessionWithAccount | undefined) ?? null;
  }

  async touch(sessionId: string, expiresAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE candidate_session SET last_seen_at = now(), expires_at = $2 WHERE id = $1`,
      [sessionId, expiresAt],
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.query(`UPDATE candidate_session SET revoked_at = now() WHERE id = $1`, [
      sessionId,
    ]);
  }
}
