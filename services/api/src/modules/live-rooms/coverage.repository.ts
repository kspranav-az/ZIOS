import { Injectable } from '@nestjs/common';
import type { CoverageStatus, SessionCoverage } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

interface CoverageRow {
  question_id: string;
  status: string;
  marked_at: Date | null;
  marked_by: string | null;
}

@Injectable()
export class CoverageRepository {
  constructor(private readonly db: DatabaseService) {}

  async ensureQuestions(sessionId: string, questionIds: string[], q: Queryable): Promise<void> {
    if (questionIds.length === 0) return;
    const values = questionIds.map((_, index) => `($1, $${index + 2})`).join(', ');
    await q.query(
      `INSERT INTO session_coverage (session_id, question_id)
       VALUES ${values}
       ON CONFLICT (session_id, question_id) DO NOTHING`,
      [sessionId, ...questionIds],
    );
  }

  async mark(
    sessionId: string,
    questionId: string,
    action: 'cover' | 'skip' | 'reset',
    markedBy: string | null,
    q: Queryable,
  ): Promise<void> {
    const statusMap: Record<typeof action, CoverageStatus> = {
      cover: 'covered',
      skip: 'skipped',
      reset: 'pending',
    };
    const status = statusMap[action];
    const now = status === 'pending' ? null : new Date();
    const by = status === 'pending' ? null : markedBy;
    await q.query(
      `INSERT INTO session_coverage (session_id, question_id, status, marked_at, marked_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, question_id) DO UPDATE SET
         status = EXCLUDED.status,
         marked_at = EXCLUDED.marked_at,
         marked_by = EXCLUDED.marked_by,
         updated_at = now()`,
      [sessionId, questionId, status, now, by],
    );
  }

  async listBySession(sessionId: string, q: Queryable = this.db): Promise<SessionCoverage[]> {
    const result = await q.query(
      `SELECT question_id, status, marked_at, marked_by
       FROM session_coverage
       WHERE session_id = $1
       ORDER BY question_id`,
      [sessionId],
    );
    return (result.rows as CoverageRow[]).map((row) => ({
      questionId: row.question_id,
      status: row.status as CoverageStatus,
      markedAt: row.marked_at?.toISOString() ?? null,
      markedBy: row.marked_by,
    }));
  }
}
