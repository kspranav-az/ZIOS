import { Injectable } from '@nestjs/common';
import type { EvaluationScore } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface EvaluationScoreRow {
  id: string;
  report_id: string;
  question_id: string;
  criterion_id: string;
  criterion_text: string;
  score: number;
  weight: number;
  evidence_span_ids: string[];
  source: string;
  scorer_id: string | null;
}

const COLUMNS =
  'id, report_id, question_id, criterion_id, criterion_text, score, weight, evidence_span_ids, source, scorer_id';

export function mapScoreRow(row: EvaluationScoreRow): EvaluationScore {
  return {
    id: row.id,
    reportId: row.report_id,
    questionId: row.question_id,
    criterionId: row.criterion_id,
    criterionText: row.criterion_text,
    score: row.score,
    weight: Number(row.weight),
    evidenceSpanIds: row.evidence_span_ids,
    source: row.source as EvaluationScore['source'],
    scorerId: row.scorer_id,
  };
}

@Injectable()
export class EvaluationScoreRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      reportId: string;
      questionId: string;
      criterionId: string;
      criterionText: string;
      score: number;
      weight: number;
      evidenceSpanIds: string[];
      source?: EvaluationScore['source'];
      scorerId?: string | null;
    },
    q: Queryable,
  ): Promise<EvaluationScore> {
    const result = await q.query(
      `INSERT INTO evaluation_score (report_id, question_id, criterion_id, criterion_text, score, weight, evidence_span_ids, source, scorer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        input.reportId,
        input.questionId,
        input.criterionId,
        input.criterionText,
        input.score,
        input.weight,
        input.evidenceSpanIds,
        input.source ?? 'ai',
        input.scorerId ?? null,
      ],
    );
    return mapScoreRow(result.rows[0] as EvaluationScoreRow);
  }

  async listByReportId(reportId: string, q: Queryable = this.db): Promise<EvaluationScore[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM evaluation_score WHERE report_id = $1 ORDER BY question_id, criterion_id`,
      [reportId],
    );
    return (result.rows as EvaluationScoreRow[]).map(mapScoreRow);
  }

  async findById(id: string, q: Queryable = this.db): Promise<EvaluationScore | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM evaluation_score WHERE id = $1`, [id]);
    const row = result.rows[0] as EvaluationScoreRow | undefined;
    return row ? mapScoreRow(row) : null;
  }

  async updateScore(id: string, newScore: number, q: Queryable): Promise<void> {
    await q.query('UPDATE evaluation_score SET score = $1 WHERE id = $2', [newScore, id]);
  }

  async deleteByReportId(reportId: string, q: Queryable): Promise<void> {
    await q.query('DELETE FROM evaluation_score WHERE report_id = $1', [reportId]);
  }
}
