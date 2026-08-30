import { Injectable } from '@nestjs/common';
import type { Org } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

interface OrgRow {
  id: string;
  name: string;
  plan: string;
  credits_balance: number;
  created_at: Date;
}

export function mapOrgRow(row: OrgRow): Org {
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    creditsBalance: row.credits_balance,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS = 'id, name, plan, credits_balance, created_at';

@Injectable()
export class OrgRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: { name: string; plan: string }, q: Queryable): Promise<Org> {
    const result = await q.query(
      `INSERT INTO "org" (name, plan) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [input.name, input.plan],
    );
    return mapOrgRow(result.rows[0] as OrgRow);
  }

  async findById(id: string, q: Queryable = this.db): Promise<Org | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM "org" WHERE id = $1`, [id]);
    const row = result.rows[0] as OrgRow | undefined;
    return row ? mapOrgRow(row) : null;
  }

  /**
   * Atomically adjusts credits_balance by delta and returns the new balance.
   * Throws if the resulting balance would be negative.
   */
  async adjustCredits(
    id: string,
    delta: number,
    q: Queryable = this.db,
  ): Promise<{ id: string; creditsBalance: number }> {
    const result = await q.query(
      `UPDATE "org"
       SET credits_balance = credits_balance + $2
       WHERE id = $1
         AND credits_balance + $2 >= 0
       RETURNING id, credits_balance`,
      [id, delta],
    );
    const row = result.rows[0] as { id: string; credits_balance: number } | undefined;
    if (!row) {
      throw new Error(`insufficient credits or org not found: ${id}`);
    }
    return { id: row.id, creditsBalance: row.credits_balance };
  }
}
