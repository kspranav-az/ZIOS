import { Injectable } from '@nestjs/common';
import type { PipelineLog, PipelineStage } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface PipelineLogRow {
  id: string;
  session_id: string | null;
  report_id: string | null;
  stages: PipelineStage[];
  total_ms: number | null;
  started_at: Date;
  completed_at: Date | null;
}

const COLUMNS = 'id, session_id, report_id, stages, total_ms, started_at, completed_at';

export function mapPipelineLogRow(row: PipelineLogRow): PipelineLog {
  return {
    id: row.id,
    sessionId: row.session_id,
    reportId: row.report_id,
    stages: row.stages,
    totalMs: row.total_ms,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

@Injectable()
export class PipelineLogRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: { sessionId: string | null; reportId: string | null },
    q: Queryable,
  ): Promise<PipelineLog> {
    const result = await q.query(
      `INSERT INTO evaluation_pipeline_log (session_id, report_id)
       VALUES ($1, $2)
       RETURNING ${COLUMNS}`,
      [input.sessionId, input.reportId],
    );
    return mapPipelineLogRow(result.rows[0] as PipelineLogRow);
  }

  async updateCompleted(
    id: string,
    stages: PipelineStage[],
    totalMs: number,
    q: Queryable,
  ): Promise<void> {
    await q.query(
      `UPDATE evaluation_pipeline_log
       SET stages = $1::jsonb, total_ms = $2, completed_at = now()
       WHERE id = $3`,
      [JSON.stringify(stages), totalMs, id],
    );
  }
}
