import { Injectable } from '@nestjs/common';
import type { ScoreOverride } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface OverrideRow {
  id: string;
  report_id: string;
  score_id: string;
  original_score: number;
  new_score: number;
  reason_code: string;
  reason_text: string | null;
  created_by: string | null;
  created_at: Date;
}

const COLUMNS =
  'id, report_id, score_id, original_score, new_score, reason_code, reason_text, created_by, created_at';

export function mapOverrideRow(row: OverrideRow): ScoreOverride {
  return {
    id: row.id,
    reportId: row.report_id,
    scoreId: row.score_id,
    originalScore: row.original_score,
    newScore: row.new_score,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class OverrideRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      reportId: string;
      scoreId: string;
      originalScore: number;
      newScore: number;
      reasonCode: string;
      reasonText?: string;
      createdBy: string | null;
    },
    q: Queryable,
  ): Promise<ScoreOverride> {
    const result = await q.query(
      `INSERT INTO evaluation_override (report_id, score_id, original_score, new_score, reason_code, reason_text, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        input.reportId,
        input.scoreId,
        input.originalScore,
        input.newScore,
        input.reasonCode,
        input.reasonText ?? null,
        input.createdBy,
      ],
    );
    return mapOverrideRow(result.rows[0] as OverrideRow);
  }

  async listByReportId(reportId: string, q: Queryable = this.db): Promise<ScoreOverride[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM evaluation_override WHERE report_id = $1 ORDER BY created_at DESC`,
      [reportId],
    );
    return (result.rows as OverrideRow[]).map(mapOverrideRow);
  }
}
