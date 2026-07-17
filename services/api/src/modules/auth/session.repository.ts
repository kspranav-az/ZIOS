import { Injectable } from '@nestjs/common';
import type { AppUser, AppUserRole } from '@zios/shared-types';
import { DatabaseService } from '@/modules/database';

export interface SessionWithUserRow {
  session_id: string;
  session_expires_at: Date;
  user_id: string;
  org_id: string;
  email: string;
  name: string;
  role: AppUserRole;
  user_created_at: Date;
}

export interface SessionWithUser {
  sessionId: string;
  sessionExpiresAt: Date;
  user: AppUser;
}

function map(row: SessionWithUserRow): SessionWithUser {
  return {
    sessionId: row.session_id,
    sessionExpiresAt: row.session_expires_at,
    user: {
      id: row.user_id,
      orgId: row.org_id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.user_created_at.toISOString(),
    },
  };
}

@Injectable()
export class SessionRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<string> {
    const result = await this.db.query(
      `INSERT INTO "session" (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
      [input.userId, input.tokenHash, input.expiresAt],
    );
    return (result.rows[0] as { id: string }).id;
  }

  /** Active (unrevoked) session by token hash, joined with its user. */
  async findActiveWithUser(tokenHash: string): Promise<SessionWithUser | null> {
    const result = await this.db.query(
      `SELECT s.id AS session_id, s.expires_at AS session_expires_at,
              u.id AS user_id, u.org_id, u.email, u.name, u.role, u.created_at AS user_created_at
         FROM "session" s
         JOIN app_user u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
      [tokenHash],
    );
    const row = result.rows[0] as SessionWithUserRow | undefined;
    return row ? map(row) : null;
  }

  /** Sliding expiry: every use re-extends the session to now + 30d. */
  async touch(sessionId: string, expiresAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE "session" SET last_seen_at = now(), expires_at = $2 WHERE id = $1`,
      [sessionId, expiresAt],
    );
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.query(`UPDATE "session" SET revoked_at = now() WHERE id = $1`, [sessionId]);
  }
}
