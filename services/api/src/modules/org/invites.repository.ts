import { Injectable } from '@nestjs/common';
import type { AppUserRole, OrgInvite } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: AppUserRole;
  token_hash: string;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}

export function mapInviteRow(row: InviteRow): OrgInvite {
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class InvitesRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Re-inviting replaces any pending invite for the same (org, email). */
  async deletePending(orgId: string, email: string, q: Queryable): Promise<void> {
    await q.query(
      `DELETE FROM org_invite WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL`,
      [orgId, email],
    );
  }

  async insert(
    input: {
      orgId: string;
      email: string;
      role: AppUserRole;
      tokenHash: string;
      invitedBy: string;
      expiresAt: Date;
    },
    q: Queryable,
  ): Promise<InviteRow> {
    const result = await q.query(
      `INSERT INTO org_invite (org_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.orgId, input.email, input.role, input.tokenHash, input.invitedBy, input.expiresAt],
    );
    return result.rows[0] as InviteRow;
  }

  async findPendingByTokenHash(tokenHash: string): Promise<InviteRow | null> {
    const result = await this.db.query(
      `SELECT * FROM org_invite WHERE token_hash = $1 AND accepted_at IS NULL`,
      [tokenHash],
    );
    return (result.rows[0] as InviteRow | undefined) ?? null;
  }

  async markAccepted(id: string, q: Queryable): Promise<void> {
    await q.query(`UPDATE org_invite SET accepted_at = now() WHERE id = $1`, [id]);
  }

  /** Compensation path when the invite email cannot be delivered. */
  async deleteById(id: string): Promise<void> {
    await this.db.query(`DELETE FROM org_invite WHERE id = $1`, [id]);
  }
}
