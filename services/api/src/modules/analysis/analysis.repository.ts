import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';
import type { AnalysisJobKind } from './analysis.queue';

export type AnalysisJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AnalysisJobRecord {
  id: string;
  kind: AnalysisJobKind;
  status: AnalysisJobStatus;
  sessionId: string;
  questionId: string | null;
  inviteId: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  schemaVersion: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface InsertAnalysisJobInput {
  kind: AnalysisJobKind;
  sessionId: string;
  questionId: string | null;
  inviteId: string | null;
  payload: Record<string, unknown>;
}

export interface AnalysisDlqInput {
  jobId: string;
  analysisJobId: string;
  kind: AnalysisJobKind;
  sessionId: string;
  questionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
}

export interface AnalysisDlqRecord {
  jobId: string;
  analysisJobId: string;
  kind: AnalysisJobKind;
  sessionId: string;
  questionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  failedAt: string;
}

interface AnalysisJobRow {
  id: string;
  kind: AnalysisJobKind;
  status: AnalysisJobStatus;
  session_id: string;
  question_id: string | null;
  invite_id: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  schema_version: string | null;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

const COLUMNS =
  'id, kind, status, session_id, question_id, invite_id, payload, result, schema_version, attempts, error_code, error_message, created_at, started_at, completed_at';

function mapRow(row: AnalysisJobRow): AnalysisJobRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    sessionId: row.session_id,
    questionId: row.question_id,
    inviteId: row.invite_id,
    payload: row.payload ?? {},
    result: row.result ?? null,
    schemaVersion: row.schema_version,
    attempts: row.attempts,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

@Injectable()
export class AnalysisRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertPending(input: InsertAnalysisJobInput, q: Queryable): Promise<AnalysisJobRecord> {
    const result = await q.query(
      `INSERT INTO analysis_job (kind, session_id, question_id, invite_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${COLUMNS}`,
      [
        input.kind,
        input.sessionId,
        input.questionId,
        input.inviteId,
        JSON.stringify(input.payload),
      ],
    );
    return mapRow(result.rows[0] as AnalysisJobRow);
  }

  /**
   * Optimistic at-most-once guard: only a pending/failed job can transition to
   * running. Returns false when another worker already claimed the job.
   */
  async markRunning(id: string, q: Queryable): Promise<boolean> {
    const result = await q.query(
      `UPDATE analysis_job
       SET status = 'running', started_at = now()
       WHERE id = $1 AND status IN ('pending', 'failed')
       RETURNING id`,
      [id],
    );
    return result.rowCount === 1;
  }

  async incrementAttempts(id: string, q: Queryable): Promise<void> {
    await q.query(`UPDATE analysis_job SET attempts = attempts + 1 WHERE id = $1`, [id]);
  }

  async markCompleted(
    id: string,
    result: Record<string, unknown>,
    schemaVersion: string | null,
    q: Queryable,
  ): Promise<void> {
    await q.query(
      `UPDATE analysis_job
       SET status = 'completed', result = $1::jsonb, schema_version = $2, completed_at = now()
       WHERE id = $3`,
      [JSON.stringify(result), schemaVersion, id],
    );
  }

  async markFailed(
    id: string,
    errorCode: string,
    errorMessage: string,
    q: Queryable = this.db,
  ): Promise<void> {
    await q.query(
      `UPDATE analysis_job
       SET status = 'failed', error_code = $1, error_message = $2, completed_at = now()
       WHERE id = $3`,
      [errorCode, errorMessage, id],
    );
  }

  async findById(id: string, q: Queryable = this.db): Promise<AnalysisJobRecord | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM analysis_job WHERE id = $1`, [id]);
    const row = result.rows[0] as AnalysisJobRow | undefined;
    return row ? mapRow(row) : null;
  }

  async findBySession(sessionId: string, q: Queryable = this.db): Promise<AnalysisJobRecord[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM analysis_job WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    return (result.rows as AnalysisJobRow[]).map(mapRow);
  }

  /**
   * Finds a job already tracking a given storage object for the session.
   * Used to dedupe repeated recording notifications (e.g. voice telemetry).
   */
  async findBySessionAndObject(
    sessionId: string,
    objectName: string,
    q: Queryable = this.db,
  ): Promise<AnalysisJobRecord | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM analysis_job
       WHERE session_id = $1 AND payload ->> 'objectName' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId, objectName],
    );
    const row = result.rows[0] as AnalysisJobRow | undefined;
    return row ? mapRow(row) : null;
  }

  async upsertDlq(input: AnalysisDlqInput, q: Queryable = this.db): Promise<void> {
    await q.query(
      `INSERT INTO analysis_job_dlq
       (job_id, analysis_job_id, kind, session_id, question_id, error_code, error_message, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (job_id) DO UPDATE SET
         error_code = EXCLUDED.error_code,
         error_message = EXCLUDED.error_message,
         attempts = EXCLUDED.attempts,
         failed_at = now()`,
      [
        input.jobId,
        input.analysisJobId,
        input.kind,
        input.sessionId,
        input.questionId,
        input.errorCode,
        input.errorMessage,
        input.attempts,
      ],
    );
  }

  async findDlqByAnalysisJobId(
    analysisJobId: string,
    q: Queryable = this.db,
  ): Promise<AnalysisDlqRecord | null> {
    const result = await q.query(
      `SELECT job_id, analysis_job_id, kind, session_id, question_id,
              error_code, error_message, attempts, failed_at
       FROM analysis_job_dlq WHERE analysis_job_id = $1`,
      [analysisJobId],
    );
    const row = result.rows[0] as
      | {
          job_id: string;
          analysis_job_id: string;
          kind: AnalysisJobKind;
          session_id: string;
          question_id: string | null;
          error_code: string | null;
          error_message: string | null;
          attempts: number;
          failed_at: Date;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      jobId: row.job_id,
      analysisJobId: row.analysis_job_id,
      kind: row.kind,
      sessionId: row.session_id,
      questionId: row.question_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      attempts: row.attempts,
      failedAt: row.failed_at.toISOString(),
    };
  }

  /**
   * Moves a DLQ'd job back to 'pending' in one transaction: reset the
   * analysis_job row (attempts/error cleared), delete the DLQ row. The DLQ
   * row is removed (not kept) because the job row itself now carries the
   * recovery audit trail via status + attempts.
   */
  async redriveFromDlq(analysisJobId: string, q: Queryable): Promise<AnalysisJobRecord | null> {
    const result = await q.query(
      `UPDATE analysis_job
       SET status = 'pending', attempts = 0,
           error_code = NULL, error_message = NULL,
           started_at = NULL, completed_at = NULL
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [analysisJobId],
    );
    const row = result.rows[0] as AnalysisJobRow | undefined;
    if (!row) {
      return null;
    }
    await q.query(`DELETE FROM analysis_job_dlq WHERE analysis_job_id = $1`, [analysisJobId]);
    return mapRow(row);
  }
}
