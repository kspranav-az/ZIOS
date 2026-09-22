import { Injectable } from '@nestjs/common';
import type { SessionTranscript } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface TranscriptRow {
  id: string;
  session_id: string;
  question_id: string;
  question_prompt: string;
  answer_text: string | null;
  answer_data: unknown;
  position: number;
  evidence_span: Array<{ start: number; end: number; transcriptId: string }>;
  created_at: Date;
  answered_at: Date | null;
}

const COLUMNS =
  'id, session_id, question_id, question_prompt, answer_text, answer_data, position, evidence_span, created_at, answered_at';

function mapRow(row: TranscriptRow): SessionTranscript {
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    questionPrompt: row.question_prompt,
    answerText: row.answer_text,
    answerData: (row.answer_data as SessionTranscript['answerData']) ?? null,
    position: row.position,
    evidenceSpan: row.evidence_span,
    createdAt: row.created_at.toISOString(),
    answeredAt: row.answered_at?.toISOString() ?? null,
  };
}

@Injectable()
export class TranscriptRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      sessionId: string;
      questionId: string;
      questionPrompt: string;
      position: number;
    },
    q: Queryable,
  ): Promise<SessionTranscript> {
    const result = await q.query(
      `INSERT INTO session_transcript (session_id, question_id, question_prompt, position)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [input.sessionId, input.questionId, input.questionPrompt, input.position],
    );
    return mapRow(result.rows[0] as TranscriptRow);
  }

  async answer(
    id: string,
    answer: string,
    q: Queryable,
    evidenceSpan?: Array<{ start: number; end: number; transcriptId: string }>,
    answerData?: SessionTranscript['answerData'],
  ): Promise<SessionTranscript | null> {
    const result = await q.query(
      `UPDATE session_transcript
       SET answer_text = $1, answer_data = $2::jsonb, answered_at = now(), evidence_span = $3::jsonb
       WHERE id = $4
       RETURNING ${COLUMNS}`,
      [
        answer,
        answerData ? JSON.stringify(answerData) : null,
        JSON.stringify(evidenceSpan ?? []),
        id,
      ],
    );
    return (result.rows[0] as TranscriptRow | undefined)
      ? mapRow(result.rows[0] as TranscriptRow)
      : null;
  }

  async findById(id: string, q: Queryable = this.db): Promise<SessionTranscript | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM session_transcript WHERE id = $1`, [id]);
    return (result.rows[0] as TranscriptRow | undefined)
      ? mapRow(result.rows[0] as TranscriptRow)
      : null;
  }

  async listBySession(sessionId: string, q: Queryable = this.db): Promise<SessionTranscript[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM session_transcript WHERE session_id = $1 ORDER BY position ASC, created_at ASC`,
      [sessionId],
    );
    return (result.rows as TranscriptRow[]).map(mapRow);
  }

  async findLastForSession(sessionId: string, q: Queryable): Promise<SessionTranscript | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM session_transcript
       WHERE session_id = $1 ORDER BY position DESC, created_at DESC LIMIT 1`,
      [sessionId],
    );
    return (result.rows[0] as TranscriptRow | undefined)
      ? mapRow(result.rows[0] as TranscriptRow)
      : null;
  }
}
