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
}
