import { Injectable } from '@nestjs/common';
import type { CommunicationMetrics } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface PracticeReportRecord {
  id: string;
  sessionId: string;
  accountId: string;
  status: 'pending' | 'completed' | 'failed';
  overallRecommendation: number | null;
  overallConfidence: number | null;
  communicationMetrics: CommunicationMetrics;
  modelRoute: string;
  promptVersions: Record<string, unknown>;
  errorMessage: string | null;
  coachingTips: CoachingTip[] | null;
  coachingTipsCost: number;
  createdAt: string;
}

export interface PracticeScoreRecord {
  id: string;
  reportId: string;
  questionId: string;
  criterionId: string;
  criterionText: string;
  score: number;
  weight: number;
  evidenceSpanIds: string[];
}

export interface PracticeEvidenceSpanRecord {
  id: string;
  reportId: string;
  transcriptId: string | null;
  questionId: string;
  start: number;
  end: number;
  quoteText: string;
}

export interface CoachingTip {
  category: 'pace' | 'fillers' | 'structure' | 'content' | 'confidence';
  tip: string;
  quoteText: string;
  questionId: string | null;
}

interface ReportRow {
  id: string;
  session_id: string;
  account_id: string;
  status: 'pending' | 'completed' | 'failed';
  overall_recommendation: number | null;
  overall_confidence: number | null;
  communication_metrics: CommunicationMetrics;
  model_route: string;
  prompt_versions: Record<string, unknown>;
  error_message: string | null;
  coaching_tips: CoachingTip[] | null;
  coaching_tips_cost: string | number;
  created_at: Date;
}

function mapReport(row: ReportRow): PracticeReportRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    accountId: row.account_id,
    status: row.status,
    overallRecommendation: row.overall_recommendation,
    overallConfidence: row.overall_confidence ? Number(row.overall_confidence) : null,
    communicationMetrics: row.communication_metrics,
    modelRoute: row.model_route,
    promptVersions: row.prompt_versions,
    errorMessage: row.error_message,
    coachingTips: row.coaching_tips,
    coachingTipsCost: Number(row.coaching_tips_cost),
    createdAt: row.created_at.toISOString(),
  };
}

const REPORT_COLUMNS = `id, session_id, account_id, status, overall_recommendation,
  overall_confidence, communication_metrics, model_route, prompt_versions, error_message,
  coaching_tips, coaching_tips_cost, created_at`;

@Injectable()
export class PracticeReportRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertPending(
    input: { sessionId: string; accountId: string },
    q: Queryable,
  ): Promise<PracticeReportRecord> {
    const result = await q.query(
      `INSERT INTO practice_report (session_id, account_id) VALUES ($1, $2)
       RETURNING ${REPORT_COLUMNS}`,
      [input.sessionId, input.accountId],
    );
    return mapReport(result.rows[0] as ReportRow);
  }

  async findBySessionId(sessionId: string, q: Queryable = this.db): Promise<PracticeReportRecord | null> {
    const result = await q.query(
      `SELECT ${REPORT_COLUMNS} FROM practice_report WHERE session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0] as ReportRow | undefined;
    return row ? mapReport(row) : null;
  }

  async updateCompleted(
    id: string,
    data: {
      overallRecommendation: number;
      overallConfidence: number;
      communicationMetrics: CommunicationMetrics;
      cost: number;
      modelRoute: string;
      promptVersions: Record<string, unknown>;
    },
    q: Queryable,
  ): Promise<void> {
    await q.query(
      `UPDATE practice_report SET
         status = 'completed',
         overall_recommendation = $2,
         overall_confidence = $3,
         communication_metrics = $4::jsonb,
         cost = $5,
         model_route = $6,
         prompt_versions = $7::jsonb,
         started_at = now(),
         completed_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        data.overallRecommendation,
        data.overallConfidence,
        JSON.stringify(data.communicationMetrics),
        data.cost,
        data.modelRoute,
        JSON.stringify(data.promptVersions),
      ],
    );
  }

  async updateFailed(id: string, message: string, q: Queryable = this.db): Promise<void> {
    await q.query(
      `UPDATE practice_report SET status = 'failed', error_message = $2, updated_at = now()
       WHERE id = $1`,
      [id, message],
    );
  }

  /** Idempotent coaching-tips write; also folds the tips cost into the report cost. */
  async updateCoachingTips(
    id: string,
    tips: CoachingTip[],
    tipsCost: number,
    q: Queryable = this.db,
  ): Promise<void> {
    await q.query(
      `UPDATE practice_report SET
         coaching_tips = $2::jsonb,
         coaching_tips_cost = $3,
         cost = cost + $3,
         prompt_versions = prompt_versions || $4::jsonb,
         updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(tips), tipsCost, JSON.stringify({ coachingTips: 'v1.0.0' })],
    );
  }

  async insertScore(
    input: {
      reportId: string;
      questionId: string;
      criterionId: string;
      criterionText: string;
      score: number;
      weight: number;
      evidenceSpanIds: string[];
    },
    q: Queryable,
  ): Promise<void> {
    await q.query(
      `INSERT INTO practice_report_score
         (report_id, question_id, criterion_id, criterion_text, score, weight, evidence_span_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[])`,
      [
        input.reportId,
        input.questionId,
        input.criterionId,
        input.criterionText,
        input.score,
        input.weight,
        input.evidenceSpanIds,
      ],
    );
  }

  async insertEvidenceSpan(
    input: {
      reportId: string;
      transcriptId: string | null;
      questionId: string;
      start: number;
      end: number;
      quoteText: string;
    },
    q: Queryable,
  ): Promise<{ id: string }> {
    const result = await q.query(
      `INSERT INTO practice_report_evidence_span
         (report_id, transcript_id, question_id, start, "end", quote_text)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.reportId, input.transcriptId, input.questionId, input.start, input.end, input.quoteText],
    );
    return result.rows[0] as { id: string };
  }

  async listScores(reportId: string, q: Queryable = this.db): Promise<PracticeScoreRecord[]> {
    const result = await q.query(
      `SELECT id, report_id, question_id, criterion_id, criterion_text, score, weight, evidence_span_ids
       FROM practice_report_score WHERE report_id = $1 ORDER BY criterion_id`,
      [reportId],
    );
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      reportId: row.report_id as string,
      questionId: row.question_id as string,
      criterionId: row.criterion_id as string,
      criterionText: row.criterion_text as string,
      score: Number(row.score),
      weight: Number(row.weight),
      evidenceSpanIds: row.evidence_span_ids as string[],
    }));
  }

  async listEvidenceSpans(
    reportId: string,
    q: Queryable = this.db,
  ): Promise<PracticeEvidenceSpanRecord[]> {
    const result = await q.query(
      `SELECT id, report_id, transcript_id, question_id, start, "end" AS end, quote_text
       FROM practice_report_evidence_span WHERE report_id = $1`,
      [reportId],
    );
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      reportId: row.report_id as string,
      transcriptId: (row.transcript_id as string | null) ?? null,
      questionId: row.question_id as string,
      start: Number(row.start),
      end: Number(row.end),
      quoteText: row.quote_text as string,
    }));
  }
}
