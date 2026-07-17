import { Injectable } from '@nestjs/common';
import type { ReportShareLink } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface ReportShareLinkRow {
  id: string;
  report_id: string;
  token_hash: string;
  expires_at: Date;
  access_count: number;
  last_accessed_at: Date | null;
  created_at: Date;
}

const COLUMNS = 'id, report_id, token_hash, expires_at, access_count, last_accessed_at, created_at';

export function mapShareLinkRow(row: ReportShareLinkRow): ReportShareLink {
  return {
    id: row.id,
    reportId: row.report_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class ShareLinkRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: { reportId: string; tokenHash: string; expiresAt: Date },
    q: Queryable,
  ): Promise<ReportShareLink> {
    const result = await q.query(
      `INSERT INTO report_share_link (report_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [input.reportId, input.tokenHash, input.expiresAt],
    );
    return mapShareLinkRow(result.rows[0] as ReportShareLinkRow);
  }

  async findByTokenHash(
    tokenHash: string,
    q: Queryable = this.db,
  ): Promise<(ReportShareLink & { reportOrgId: string }) | null> {
    const result = await q.query(
      `SELECT l.${COLUMNS.replace(/, /g, ', l.')}, r.org_id AS report_org_id
       FROM report_share_link l
       JOIN evaluation_report r ON r.id = l.report_id
       WHERE l.token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0] as (ReportShareLinkRow & { report_org_id: string }) | undefined;
    if (!row) return null;
    return { ...mapShareLinkRow(row), reportOrgId: row.report_org_id };
  }

  async incrementAccess(id: string, q: Queryable): Promise<void> {
    await q.query(
      'UPDATE report_share_link SET access_count = access_count + 1, last_accessed_at = now() WHERE id = $1',
      [id],
    );
  }
}
