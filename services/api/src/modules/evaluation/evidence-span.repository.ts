import { Injectable } from '@nestjs/common';
import type { EvidenceSpan } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface EvidenceSpanRow {
  id: string;
  report_id: string;
  transcript_id: string | null;
  question_id: string;
  start: number;
  end: number;
  quote_text: string;
}

const COLUMNS = 'id, report_id, transcript_id, question_id, start, "end", quote_text';

export function mapEvidenceSpanRow(row: EvidenceSpanRow): EvidenceSpan {
  return {
    id: row.id,
    reportId: row.report_id,
    transcriptId: row.transcript_id,
    questionId: row.question_id,
    start: row.start,
    end: row.end,
    quoteText: row.quote_text,
  };
}

@Injectable()
export class EvidenceSpanRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      reportId: string;
      transcriptId: string;
      questionId: string;
      start: number;
      end: number;
      quoteText: string;
    },
    q: Queryable,
  ): Promise<EvidenceSpan> {
    const result = await q.query(
      `INSERT INTO evaluation_evidence_span (report_id, transcript_id, question_id, start, "end", quote_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        input.reportId,
        input.transcriptId,
        input.questionId,
        input.start,
        input.end,
        input.quoteText,
      ],
    );
    return mapEvidenceSpanRow(result.rows[0] as EvidenceSpanRow);
  }

  async listByReportId(reportId: string, q: Queryable = this.db): Promise<EvidenceSpan[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM evaluation_evidence_span WHERE report_id = $1 ORDER BY question_id, start`,
      [reportId],
    );
    return (result.rows as EvidenceSpanRow[]).map(mapEvidenceSpanRow);
  }
}
