import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface CandidateResumeRecord {
  id: string;
  accountId: string;
  fileKey: string;
  fileName: string;
  contentType: string;
  parsed: Record<string, unknown> | null;
  atsReport: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ResumeRow {
  id: string;
  account_id: string;
  file_key: string;
  file_name: string;
  content_type: string;
  parsed: Record<string, unknown> | null;
  ats_report: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: ResumeRow): CandidateResumeRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    fileKey: row.file_key,
    fileName: row.file_name,
    contentType: row.content_type,
    parsed: row.parsed,
    atsReport: row.ats_report,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLUMNS = `id, account_id, file_key, file_name, content_type, parsed, ats_report, created_at, updated_at`;

@Injectable()
export class CandidateResumeRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByAccountId(accountId: string, q: Queryable = this.db): Promise<CandidateResumeRecord | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM candidate_resume WHERE account_id = $1`, [
      accountId,
    ]);
    const row = result.rows[0] as ResumeRow | undefined;
    return row ? mapRow(row) : null;
  }

  /** Insert-or-replace (unique account_id): re-upload swaps file + clears derived data. */
  async upsert(
    input: { accountId: string; fileKey: string; fileName: string; contentType: string },
    q: Queryable = this.db,
  ): Promise<CandidateResumeRecord> {
    const result = await q.query(
      `INSERT INTO candidate_resume (account_id, file_key, file_name, content_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE SET
         file_key = EXCLUDED.file_key,
         file_name = EXCLUDED.file_name,
         content_type = EXCLUDED.content_type,
         parsed = NULL,
         ats_report = NULL,
         updated_at = now()
       RETURNING ${COLUMNS}`,
      [input.accountId, input.fileKey, input.fileName, input.contentType],
    );
    return mapRow(result.rows[0] as ResumeRow);
  }

  async updateParsed(
    id: string,
    parsed: Record<string, unknown>,
    atsReport: Record<string, unknown>,
    q: Queryable = this.db,
  ): Promise<void> {
    await q.query(
      `UPDATE candidate_resume SET parsed = $2::jsonb, ats_report = $3::jsonb, updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(parsed), JSON.stringify(atsReport)],
    );
  }

  async deleteByAccountId(accountId: string, q: Queryable = this.db): Promise<string | null> {
    const result = await q.query(
      `DELETE FROM candidate_resume WHERE account_id = $1 RETURNING file_key`,
      [accountId],
    );
    const row = result.rows[0] as { file_key: string } | undefined;
    return row?.file_key ?? null;
  }
}
