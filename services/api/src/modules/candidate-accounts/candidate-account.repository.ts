import { Injectable } from '@nestjs/common';
import type { CandidateAccount } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

interface CandidateAccountRow {
  id: string;
  email: string;
  phone: string | null;
  name: string;
  target_role: string | null;
  onboarding: Record<string, unknown>;
  marketing_opt_in: boolean;
  created_at: Date;
}

export function mapCandidateAccountRow(row: CandidateAccountRow): CandidateAccount {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    name: row.name,
    targetRole: row.target_role,
    onboarding: row.onboarding,
    marketingOptIn: row.marketing_opt_in,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS =
  'id, email, phone, name, target_role, onboarding, marketing_opt_in, created_at';

@Injectable()
export class CandidateAccountRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string, q: Queryable = this.db): Promise<CandidateAccount | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM candidate_account WHERE id = $1`, [id]);
    const row = result.rows[0] as CandidateAccountRow | undefined;
    return row ? mapCandidateAccountRow(row) : null;
  }

  async findByEmail(email: string, q: Queryable = this.db): Promise<CandidateAccount | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM candidate_account WHERE email = $1`, [
      email.trim(),
    ]);
    const row = result.rows[0] as CandidateAccountRow | undefined;
    return row ? mapCandidateAccountRow(row) : null;
  }

  async insert(email: string, q: Queryable): Promise<CandidateAccount> {
    const result = await q.query(
      `INSERT INTO candidate_account (email) VALUES ($1) RETURNING ${COLUMNS}`,
      [email.trim()],
    );
    return mapCandidateAccountRow(result.rows[0] as CandidateAccountRow);
  }

  async updateProfile(
    id: string,
    patch: { name?: string; targetRole?: string | null; marketingOptIn?: boolean },
    q: Queryable = this.db,
  ): Promise<CandidateAccount | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (patch.name !== undefined) {
      params.push(patch.name);
      sets.push(`name = $${params.length}`);
    }
    if (patch.targetRole !== undefined) {
      params.push(patch.targetRole);
      sets.push(`target_role = $${params.length}`);
    }
    if (patch.marketingOptIn !== undefined) {
      params.push(patch.marketingOptIn);
      sets.push(`marketing_opt_in = $${params.length}`);
    }
    if (patch.targetRole !== undefined && patch.targetRole !== null) {
      params.push({ onboarded: true, targetRole: patch.targetRole });
      sets.push(`onboarding = onboarding || $${params.length}::jsonb`);
    }
    if (sets.length === 0) {
      return this.findById(id, q);
    }
    const result = await q.query(
      `UPDATE candidate_account SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params,
    );
    const row = result.rows[0] as CandidateAccountRow | undefined;
    return row ? mapCandidateAccountRow(row) : null;
  }

  async touchLastLogin(id: string, q: Queryable): Promise<void> {
    await q.query(`UPDATE candidate_account SET last_login_at = now() WHERE id = $1`, [id]);
  }
}
