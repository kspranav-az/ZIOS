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
}
