import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface OtpRow {
  id: string;
  email: string;
  code_hash: string;
  salt: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

@Injectable()
export class OtpRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Most recent code row for the email, consumed or not. */
  async findLatest(email: string): Promise<OtpRow | null> {
    const result = await this.db.query(
      `SELECT * FROM otp_code WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    return (result.rows[0] as OtpRow | undefined) ?? null;
  }

  async insert(
    input: { email: string; codeHash: string; salt: string; expiresAt: Date },
    q: Queryable,
  ): Promise<OtpRow> {
    const result = await q.query(
      `INSERT INTO otp_code (email, code_hash, salt, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.email, input.codeHash, input.salt, input.expiresAt],
    );
    return result.rows[0] as OtpRow;
  }

  /** Supersede every still-active code for the email (new issue / successful verify). */
  async consumeAllForEmail(email: string, q: Queryable): Promise<void> {
    await q.query(
      `UPDATE otp_code SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL`,
      [email],
    );
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.db.query(`UPDATE otp_code SET attempts = attempts + 1 WHERE id = $1`, [id]);
  }

  async markConsumed(id: string, q: Queryable = this.db): Promise<void> {
    await q.query(`UPDATE otp_code SET consumed_at = now() WHERE id = $1`, [id]);
  }
}
