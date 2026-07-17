import { Injectable } from '@nestjs/common';
import type { Candidate } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface CandidateRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string | null;
  external_ref: string | null;
  pii_vault_ref: string | null;
  created_at: Date;
}

const COLUMNS = 'id, org_id, name, email, phone, external_ref, pii_vault_ref, created_at';

function mapRow(row: CandidateRow): Candidate {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    externalRef: row.external_ref,
    piiVaultRef: row.pii_vault_ref,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class CandidatesRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      orgId: string;
      name: string;
      email: string;
      phone?: string;
      externalRef?: string;
      piiVaultRef?: string;
    },
    q: Queryable,
  ): Promise<Candidate> {
    const result = await q.query(
      `INSERT INTO candidate (org_id, name, email, phone, external_ref, pii_vault_ref)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.name,
        input.email,
        input.phone ?? null,
        input.externalRef ?? null,
        input.piiVaultRef ?? null,
      ],
    );
    return mapRow(result.rows[0] as CandidateRow);
  }

  async findById(orgId: string, id: string, q: Queryable): Promise<Candidate | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM candidate WHERE id = $1 AND org_id = $2`, [
      id,
      orgId,
    ]);
    const row = result.rows[0] as CandidateRow | undefined;
    return row ? mapRow(row) : null;
  }

  async update(
    orgId: string,
    id: string,
    fields: { name?: string; email?: string; phone?: string | null; externalRef?: string | null },
    q: Queryable,
  ): Promise<Candidate | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.name !== undefined) {
      params.push(fields.name);
      sets.push(`name = $${params.length}`);
    }
    if (fields.email !== undefined) {
      params.push(fields.email);
      sets.push(`email = $${params.length}`);
    }
    if (fields.phone !== undefined) {
      params.push(fields.phone);
      sets.push(`phone = $${params.length}`);
    }
    if (fields.externalRef !== undefined) {
      params.push(fields.externalRef);
      sets.push(`external_ref = $${params.length}`);
    }
    if (sets.length === 0) {
      return this.findById(orgId, id, q);
    }
    params.push(id, orgId);
    const result = await q.query(
      `UPDATE candidate SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND org_id = $${params.length}
       RETURNING ${COLUMNS}`,
      params,
    );
    const row = result.rows[0] as CandidateRow | undefined;
    return row ? mapRow(row) : null;
  }
}
