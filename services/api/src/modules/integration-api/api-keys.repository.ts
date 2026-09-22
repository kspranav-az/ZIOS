import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export type ApiKeyKind = 'test' | 'live';

export interface ApiKeyRecord {
  id: string;
  orgId: string;
  kind: ApiKeyKind;
  keyHash: string;
  prefix: string;
  label: string | null;
  scopes: string[];
  rateLimitPerMin: number;
  createdBy: string;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

export interface InsertApiKeyInput {
  orgId: string;
  kind: ApiKeyKind;
  keyHash: string;
  prefix: string;
  label?: string | null;
  scopes?: string[];
  rateLimitPerMin?: number;
  createdBy: string;
}

interface ApiKeyRow {
  id: string;
  org_id: string;
  kind: ApiKeyKind;
  key_hash: string;
  prefix: string;
  label: string | null;
  scopes: string[];
  rate_limit_per_min: number;
  created_by: string;
  created_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
}

const COLUMNS =
  'id, org_id, kind, key_hash, prefix, label, scopes, rate_limit_per_min, created_by, created_at, rotated_at, revoked_at';

function mapRow(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind,
    keyHash: row.key_hash,
    prefix: row.prefix,
    label: row.label,
    scopes: row.scopes,
    rateLimitPerMin: row.rate_limit_per_min,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    rotatedAt: row.rotated_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

@Injectable()
export class ApiKeysRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: InsertApiKeyInput, q: Queryable = this.db): Promise<ApiKeyRecord> {
    const result = await q.query(
      `INSERT INTO api_key (org_id, kind, key_hash, prefix, label, scopes, rate_limit_per_min, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8)
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.kind,
        input.keyHash,
        input.prefix,
        input.label ?? null,
        input.scopes ?? ['interviews:read', 'interviews:write'],
        input.rateLimitPerMin ?? 120,
        input.createdBy,
      ],
    );
    return mapRow(result.rows[0] as ApiKeyRow);
  }

  async listByOrg(orgId: string, q: Queryable = this.db): Promise<ApiKeyRecord[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM api_key WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId],
    );
    return (result.rows as ApiKeyRow[]).map(mapRow);
  }

  async findById(id: string, q: Queryable = this.db): Promise<ApiKeyRecord | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM api_key WHERE id = $1`, [id]);
    const row = result.rows[0] as ApiKeyRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Authentication lookup: only non-revoked keys authenticate. The hash is
   * unique, so this is a point query.
   */
  async findActiveByHash(keyHash: string, q: Queryable = this.db): Promise<ApiKeyRecord | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM api_key WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash],
    );
    const row = result.rows[0] as ApiKeyRow | undefined;
    return row ? mapRow(row) : null;
  }

  /** Rotation: replace hash + display prefix in place; old key stops working. */
  async replaceKeyMaterial(
    id: string,
    keyHash: string,
    prefix: string,
    q: Queryable = this.db,
  ): Promise<ApiKeyRecord> {
    const result = await q.query(
      `UPDATE api_key SET key_hash = $1, prefix = $2, rotated_at = now()
       WHERE id = $3 RETURNING ${COLUMNS}`,
      [keyHash, prefix, id],
    );
    return mapRow(result.rows[0] as ApiKeyRow);
  }

  async revoke(id: string, q: Queryable = this.db): Promise<void> {
    await q.query(`UPDATE api_key SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
      id,
    ]);
  }
}
