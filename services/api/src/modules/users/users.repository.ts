import { Injectable } from '@nestjs/common';
import type { AppUser, AppUserRole } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: AppUserRole;
  created_at: Date;
}

export function mapUserRow(row: UserRow): AppUser {
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS = 'id, org_id, email, name, role, created_at';

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByEmail(email: string, q: Queryable = this.db): Promise<AppUser | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM app_user WHERE email = $1`, [email]);
    const row = result.rows[0] as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  async findById(id: string, q: Queryable = this.db): Promise<AppUser | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM app_user WHERE id = $1`, [id]);
    const row = result.rows[0] as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  async insert(
    input: { orgId: string; email: string; name: string; role: AppUserRole },
    q: Queryable,
  ): Promise<AppUser> {
    const result = await q.query(
      `INSERT INTO app_user (org_id, email, name, role) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [input.orgId, input.email, input.name, input.role],
    );
    return mapUserRow(result.rows[0] as UserRow);
  }

  async listByOrg(orgId: string, q: Queryable = this.db): Promise<AppUser[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM app_user WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId],
    );
    return (result.rows as UserRow[]).map(mapUserRow);
  }

  async findByOrgAndEmail(orgId: string, email: string): Promise<AppUser | null> {
    const result = await this.db.query(
      `SELECT ${COLUMNS} FROM app_user WHERE org_id = $1 AND email = $2`,
      [orgId, email],
    );
    const row = result.rows[0] as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  /** Moves the user into another org with the given role (invite accept). */
  async updateOrgAndRole(
    userId: string,
    orgId: string,
    role: AppUserRole,
    q: Queryable,
  ): Promise<AppUser> {
    const result = await q.query(
      `UPDATE app_user SET org_id = $2, role = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
      [userId, orgId, role],
    );
    return mapUserRow(result.rows[0] as UserRow);
  }
}
