import { Injectable } from '@nestjs/common';
import type { InterviewNotes } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface InterviewNotesRow {
  id: string;
  session_id: string;
  summary: string;
  question_mapping: Array<{ questionId: string; prompt: string; note: string }>;
  generated_by: string;
  generated_at: Date;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, session_id, summary, question_mapping, generated_by, generated_at, created_at, updated_at';

export function mapNotesRow(row: InterviewNotesRow): InterviewNotes {
  return {
    id: row.id,
    sessionId: row.session_id,
    summary: row.summary,
    questionMapping: row.question_mapping,
    generatedBy: row.generated_by as InterviewNotes['generatedBy'],
    generatedAt: row.generated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class InterviewNotesRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      sessionId: string;
      summary: string;
      questionMapping: InterviewNotes['questionMapping'];
      generatedBy?: InterviewNotes['generatedBy'];
    },
    q: Queryable,
  ): Promise<InterviewNotes> {
    const result = await q.query(
      `INSERT INTO interview_notes (session_id, summary, question_mapping, generated_by)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING ${COLUMNS}`,
      [
        input.sessionId,
        input.summary,
        JSON.stringify(input.questionMapping),
        input.generatedBy ?? 'ai',
      ],
    );
    return mapNotesRow(result.rows[0] as InterviewNotesRow);
  }

  async findBySessionId(sessionId: string, q: Queryable = this.db): Promise<InterviewNotes | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM interview_notes WHERE session_id = $1`, [
      sessionId,
    ]);
    const row = result.rows[0] as InterviewNotesRow | undefined;
    return row ? mapNotesRow(row) : null;
  }

  async findById(id: string, q: Queryable = this.db): Promise<InterviewNotes | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM interview_notes WHERE id = $1`, [id]);
    const row = result.rows[0] as InterviewNotesRow | undefined;
    return row ? mapNotesRow(row) : null;
  }
}
