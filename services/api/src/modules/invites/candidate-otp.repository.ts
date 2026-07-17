import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface CandidateOtpRow {
  id: string;
  invite_id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

const COLUMNS = 'id, invite_id, code_hash, attempts, expires_at, consumed_at, created_at';

@Injectable()
export class CandidateOtpRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: { inviteId: string; codeHash: string; expiresAt: Date },
    q: Queryable,
  ): Promise<CandidateOtpRow> {
    const result = await q.query(
      `INSERT INTO candidate_otp (invite_id, code_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [input.inviteId, input.codeHash, input.expiresAt],
    );
    return result.rows[0] as CandidateOtpRow;
  }

  /** Latest unconsumed code for an invite, regardless of expiry (caller checks). */
  async findLatestByInviteId(inviteId: string, q: Queryable): Promise<CandidateOtpRow | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM candidate_otp
       WHERE invite_id = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [inviteId],
    );
    return (result.rows[0] as CandidateOtpRow | undefined) ?? null;
  }

  async incrementAttempts(id: string, q: Queryable): Promise<void> {
    await q.query('UPDATE candidate_otp SET attempts = attempts + 1 WHERE id = $1', [id]);
  }

  async consume(id: string, q: Queryable): Promise<void> {
    await q.query('UPDATE candidate_otp SET consumed_at = now() WHERE id = $1', [id]);
  }

  /** Marks every unconsumed code for the invite as consumed (token rotation / reissue). */
  async revokeActiveForInvite(inviteId: string, q: Queryable): Promise<void> {
    await q.query(
      'UPDATE candidate_otp SET consumed_at = now() WHERE invite_id = $1 AND consumed_at IS NULL',
      [inviteId],
    );
  }
}
