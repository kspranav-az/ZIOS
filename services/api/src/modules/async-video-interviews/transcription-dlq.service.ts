import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface TranscriptionDlqInput {
  jobId: string;
  transcriptId: string;
  objectName: string;
  sessionId: string;
  questionId: string;
  errorMessage: string;
  attempts: number;
}

export interface TranscriptionDlqRecord {
  jobId: string;
  transcriptId: string;
  objectName: string;
  sessionId: string;
  questionId: string;
  errorMessage: string | null;
  attempts: number;
  failedAt: string;
}

interface TranscriptionDlqRow {
  job_id: string;
  transcript_id: string;
  object_name: string;
  session_id: string;
  question_id: string;
  error_message: string | null;
  attempts: number;
  failed_at: Date;
}

function mapRow(row: TranscriptionDlqRow): TranscriptionDlqRecord {
  return {
    jobId: row.job_id,
    transcriptId: row.transcript_id,
    objectName: row.object_name,
    sessionId: row.session_id,
    questionId: row.question_id,
    errorMessage: row.error_message,
    attempts: row.attempts,
    failedAt: row.failed_at.toISOString(),
  };
}

@Injectable()
export class TranscriptionDlqService {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: TranscriptionDlqInput, q?: Queryable): Promise<void> {
    const runner = q ?? this.db;
    await runner.query(
      `INSERT INTO transcription_job_dlq
       (job_id, transcript_id, object_name, session_id, question_id, error_message, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (job_id) DO UPDATE SET
         error_message = EXCLUDED.error_message,
         attempts = EXCLUDED.attempts,
         failed_at = now()`,
      [
        input.jobId,
        input.transcriptId,
        input.objectName,
        input.sessionId,
        input.questionId,
        input.errorMessage,
        input.attempts,
      ],
    );
  }

  async findByTranscriptId(
    transcriptId: string,
    q?: Queryable,
  ): Promise<TranscriptionDlqRecord | null> {
    const runner = q ?? this.db;
    const result = await runner.query(
      `SELECT job_id, transcript_id, object_name, session_id, question_id,
              error_message, attempts, failed_at
       FROM transcription_job_dlq WHERE transcript_id = $1`,
      [transcriptId],
    );
    const row = result.rows[0] as TranscriptionDlqRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Moves a DLQ'd transcription job back to 'pending' in one transaction:
   * reset the transcription_job row (attempts/error cleared) and delete the
   * DLQ row.
   */
  async redriveFromDlq(transcriptId: string, q: Queryable): Promise<TranscriptionDlqRecord> {
    await q.query(
      `UPDATE transcription_job
       SET status = 'pending', attempts = 0,
           error_message = NULL, started_at = NULL, completed_at = NULL
       WHERE transcript_id = $1`,
      [transcriptId],
    );
    const dlq = await this.findByTranscriptId(transcriptId, q);
    if (!dlq) {
      throw new Error(`transcription DLQ row for transcript ${transcriptId} vanished mid-redrive`);
    }
    await q.query(`DELETE FROM transcription_job_dlq WHERE transcript_id = $1`, [transcriptId]);
    return dlq;
  }
}
