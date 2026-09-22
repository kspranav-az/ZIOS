import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface ExternalInterviewRecord {
  id: string;
  orgId: string;
  externalRef: string;
  kitVersionId: string;
  inviteId: string;
  createdAt: string;
}

interface ExternalInterviewRow {
  id: string;
  org_id: string;
  external_ref: string;
  kit_version_id: string;
  invite_id: string;
  created_at: Date;
}

const COLUMNS = 'id, org_id, external_ref, kit_version_id, invite_id, created_at';

function mapRow(row: ExternalInterviewRow): ExternalInterviewRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    externalRef: row.external_ref,
    kitVersionId: row.kit_version_id,
    inviteId: row.invite_id,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class ExternalInterviewRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Idempotency anchor for POST /v1/interviews. ON CONFLICT DO NOTHING:
   * concurrent retries resolve to a single winning row.
   *
   * @returns the inserted row, or null when this identity already exists.
   */
  async insertIdempotent(
    input: { orgId: string; externalRef: string; kitVersionId: string; inviteId: string },
    q: Queryable = this.db,
  ): Promise<ExternalInterviewRecord | null> {
    const result = await q.query(
      `INSERT INTO external_interview (org_id, external_ref, kit_version_id, invite_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, external_ref, kit_version_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [input.orgId, input.externalRef, input.kitVersionId, input.inviteId],
    );
    const row = result.rows[0] as ExternalInterviewRow | undefined;
    return row ? mapRow(row) : null;
  }

  async findById(id: string, orgId: string, q: Queryable = this.db): Promise<ExternalInterviewRecord | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM external_interview WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    const row = result.rows[0] as ExternalInterviewRow | undefined;
    return row ? mapRow(row) : null;
  }

  /** Latest row for a partner ref (used to resolve create-time conflicts). */
  async findByExternalRef(
    orgId: string,
    externalRef: string,
    kitVersionId: string,
    q: Queryable = this.db,
  ): Promise<ExternalInterviewRecord | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM external_interview
       WHERE org_id = $1 AND external_ref = $2 AND kit_version_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [orgId, externalRef, kitVersionId],
    );
    const row = result.rows[0] as ExternalInterviewRow | undefined;
    return row ? mapRow(row) : null;
  }
}
