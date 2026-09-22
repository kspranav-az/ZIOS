import { Injectable } from '@nestjs/common';
import type { SessionTranscript } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

interface TranscriptRow {
  id: string;
  session_id: string;
  question_id: string;
  question_prompt: string;
  answer_text: string | null;
  answer_data: SessionTranscript['answerData'];
  position: number;
  evidence_span: Array<{ start: number; end: number; transcriptId: string }>;
  created_at: Date;
  answered_at: Date | null;
}

function mapRow(row: TranscriptRow): SessionTranscript {
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    questionPrompt: row.question_prompt,
    answerText: row.answer_text,
    answerData: row.answer_data,
    position: row.position,
    evidenceSpan: row.evidence_span ?? [],
    createdAt: row.created_at.toISOString(),
    answeredAt: row.answered_at ? row.answered_at.toISOString() : null,
  };
}

@Injectable()
export class PracticeTranscriptRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: { sessionId: string; questionId: string; questionPrompt: string; position: number },
    q: Queryable,
  ): Promise<void> {
    await q.query(
      `INSERT INTO practice_transcript (session_id, question_id, question_prompt, position)
       VALUES ($1, $2, $3, $4)`,
      [input.sessionId, input.questionId, input.questionPrompt, input.position],
    );
  }

  async listBySession(sessionId: string, q: Queryable = this.db): Promise<SessionTranscript[]> {
    const result = await q.query(
      `SELECT id, session_id, question_id, question_prompt, answer_text, answer_data, position,
              evidence_span, created_at, answered_at
       FROM practice_transcript WHERE session_id = $1
       ORDER BY position ASC, created_at ASC`,
      [sessionId],
    );
    return (result.rows as TranscriptRow[]).map(mapRow);
  }

  async answer(
    id: string,
    answerText: string,
    q: Queryable,
    answerData?: SessionTranscript['answerData'],
  ): Promise<void> {
    await q.query(
      `UPDATE practice_transcript SET answer_text = $2, answered_at = now(), answer_data = $3
       WHERE id = $1`,
      [id, answerText, answerData === undefined ? null : JSON.stringify(answerData)],
    );
  }
}
