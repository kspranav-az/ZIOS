import { Injectable } from '@nestjs/common';
import type {
  Candidate,
  CommunicationMetrics,
  EvaluationReport,
  EvaluationStatus,
  ReportListItem,
} from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface EvaluationReportRow {
  id: string;
  org_id: string;
  session_id: string;
  invite_id: string | null;
  kit_version_id: string;
  status: string;
  overall_recommendation: number | null;
  overall_confidence: number | null;
  communication_metrics: CommunicationMetrics;
  rubric_version: string;
  model_route: string;
  cost: number | null;
  prompt_versions: Record<string, unknown>;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, org_id, session_id, invite_id, kit_version_id, status, overall_recommendation, overall_confidence, communication_metrics, rubric_version, model_route, cost, prompt_versions, error_message, started_at, completed_at, created_at, updated_at';

export function mapReportRow(row: EvaluationReportRow): EvaluationReport {
  return {
    id: row.id,
    orgId: row.org_id,
    sessionId: row.session_id,
    inviteId: row.invite_id,
    kitVersionId: row.kit_version_id,
    status: row.status as EvaluationStatus,
    overallRecommendation: row.overall_recommendation,
    overallConfidence: row.overall_confidence === null ? null : Number(row.overall_confidence),
    communicationMetrics: row.communication_metrics,
    rubricVersion: row.rubric_version,
    modelRoute: row.model_route,
    cost: row.cost === null ? null : Number(row.cost),
    promptVersions: row.prompt_versions,
    errorMessage: row.error_message,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class EvaluationRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      orgId: string;
      sessionId: string;
      inviteId: string | null;
      kitVersionId: string;
      status: EvaluationStatus;
      rubricVersion?: string;
      modelRoute?: string;
      cost?: number;
    },
    q: Queryable,
  ): Promise<EvaluationReport> {
    const result = await q.query(
      `INSERT INTO evaluation_report (org_id, session_id, invite_id, kit_version_id, status, rubric_version, model_route, cost, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.sessionId,
        input.inviteId,
        input.kitVersionId,
        input.status,
        input.rubricVersion ?? 'phase04-stub',
        input.modelRoute ?? 'stub-judge',
        input.cost ?? 0,
      ],
    );
    return mapReportRow(result.rows[0] as EvaluationReportRow);
  }

  async findById(id: string, q: Queryable = this.db): Promise<EvaluationReport | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM evaluation_report WHERE id = $1`, [id]);
    const row = result.rows[0] as EvaluationReportRow | undefined;
    return row ? mapReportRow(row) : null;
  }

  async findBySessionId(
    sessionId: string,
    q: Queryable = this.db,
  ): Promise<EvaluationReport | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM evaluation_report WHERE session_id = $1`, [
      sessionId,
    ]);
    const row = result.rows[0] as EvaluationReportRow | undefined;
    return row ? mapReportRow(row) : null;
  }

  async updateCompleted(
    id: string,
    fields: {
      overallRecommendation: number;
      overallConfidence: number;
      communicationMetrics: CommunicationMetrics;
      cost?: number;
      promptVersions?: Record<string, unknown>;
    },
    q: Queryable,
  ): Promise<EvaluationReport | null> {
    const result = await q.query(
      `UPDATE evaluation_report
       SET status = 'completed',
           overall_recommendation = $1,
           overall_confidence = $2,
           communication_metrics = $3::jsonb,
           cost = $4,
           prompt_versions = $5::jsonb,
           completed_at = now(),
           updated_at = now()
       WHERE id = $6
       RETURNING ${COLUMNS}`,
      [
        fields.overallRecommendation,
        fields.overallConfidence,
        JSON.stringify(fields.communicationMetrics),
        fields.cost ?? 0,
        JSON.stringify(fields.promptVersions ?? {}),
        id,
      ],
    );
    const row = result.rows[0] as EvaluationReportRow | undefined;
    return row ? mapReportRow(row) : null;
  }

  async updateFailed(id: string, errorMessage: string, q: Queryable): Promise<void> {
    await q.query(
      `UPDATE evaluation_report
       SET status = 'failed', error_message = $1, completed_at = now(), updated_at = now()
       WHERE id = $2`,
      [errorMessage, id],
    );
  }

  async listByOrg(
    orgId: string,
    filters: { status?: EvaluationStatus; q?: string; page: number; pageSize: number },
    q: Queryable = this.db,
  ): Promise<{ items: ReportListItem[]; total: number }> {
    const conditions = ['r.org_id = $1'];
    const params: unknown[] = [orgId];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`r.status = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countResult = await q.query(
      `SELECT COUNT(*) AS total
       FROM evaluation_report r
       JOIN interview_session s ON s.id = r.session_id
       JOIN invite i ON i.id = s.invite_id
       JOIN candidate c ON c.id = i.candidate_id
       WHERE ${where}`,
      params,
    );
    const total = Number((countResult.rows[0] as { total: string }).total);

    const offset = (filters.page - 1) * filters.pageSize;
    params.push(filters.pageSize, offset);
    const result = await q.query(
      `SELECT r.${COLUMNS.replace(/, /g, ', r.')},
              c.id AS candidate_id, c.org_id AS candidate_org_id, c.name AS candidate_name,
              c.email AS candidate_email, c.phone AS candidate_phone,
              c.external_ref AS candidate_external_ref, c.pii_vault_ref AS candidate_pii_vault_ref,
              c.created_at AS candidate_created_at,
              (kv.snapshot->'kit'->>'title') AS kit_title
       FROM evaluation_report r
       JOIN interview_session s ON s.id = r.session_id
       JOIN invite i ON i.id = s.invite_id
       JOIN candidate c ON c.id = i.candidate_id
       JOIN kit_version kv ON kv.id = r.kit_version_id
       WHERE ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const items = result.rows.map((row) => {
      const report = mapReportRow(row as EvaluationReportRow);
      const candidate: Candidate = {
        id: row.candidate_id as string,
        orgId: row.candidate_org_id as string,
        name: row.candidate_name as string,
        email: row.candidate_email as string,
        phone: row.candidate_phone as string | null,
        externalRef: row.candidate_external_ref as string | null,
        piiVaultRef: row.candidate_pii_vault_ref as string | null,
        createdAt: (row.candidate_created_at as Date).toISOString(),
      };
      return { report, candidate, kitTitle: (row.kit_title as string) ?? '' };
    });
    return { items, total };
  }

  async belongsToOrg(id: string, orgId: string, q: Queryable = this.db): Promise<boolean> {
    const result = await q.query('SELECT 1 FROM evaluation_report WHERE id = $1 AND org_id = $2', [
      id,
      orgId,
    ]);
    return result.rows.length > 0;
  }
}
