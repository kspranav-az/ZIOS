import { Controller, Get, Query } from '@nestjs/common';
import type { AppUser, DashboardListResponse } from '@zios/shared-types';
import { CurrentUser } from '@/common/decorators';
import { DatabaseService } from '@/modules/database';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Employer dashboard: paginated list of interview sessions for the org with
   * candidate identity, kit title, session status, and latest report summary.
   */
  @Get('interviews')
  async listInterviews(
    @CurrentUser() user: AppUser,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ): Promise<DashboardListResponse> {
    const pageNum = Math.max(1, Number(page ?? 1));
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize ?? DEFAULT_PAGE_SIZE)));
    const offset = (pageNum - 1) * size;

    const countResult = await this.db.query(
      `SELECT COUNT(*) AS total
       FROM interview_session s
       JOIN invite i ON i.id = s.invite_id
       WHERE i.org_id = $1`,
      [user.orgId],
    );
    const total = Number((countResult.rows[0] as { total: string }).total);

    const result = await this.db.query(
      `SELECT s.id, s.status, s.mode, s.conductor, s.started_at, s.ended_at, s.created_at, s.updated_at,
              s.recovery_token_hash, s.consent_id, s.preflight_report, s.media_refs, s.integrity_events,
              s.schema_version,
              c.id AS candidate_id, c.org_id AS candidate_org_id, c.name AS candidate_name,
              c.email AS candidate_email, c.phone AS candidate_phone,
              c.external_ref AS candidate_external_ref, c.pii_vault_ref AS candidate_pii_vault_ref,
              c.created_at AS candidate_created_at,
              (kv.snapshot->'kit'->>'title') AS kit_title,
              r.id AS report_id, r.status AS report_status,
              r.overall_recommendation, r.communication_metrics, r.error_message
       FROM interview_session s
       JOIN invite i ON i.id = s.invite_id
       JOIN candidate c ON c.id = i.candidate_id
       JOIN kit_version kv ON kv.id = s.kit_version_id
       LEFT JOIN evaluation_report r ON r.session_id = s.id
       WHERE i.org_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [user.orgId, size, offset],
    );

    const items = result.rows.map((row) => {
      const flags: string[] = [];
      if (row.report_status === 'failed') flags.push('evaluation_failed');
      if (row.report_status === 'pending') flags.push('evaluation_pending');
      if (row.overall_recommendation !== null && row.overall_recommendation <= 2) {
        flags.push('low_recommendation');
      }
      if (row.report_status === null && row.status === 'completed') {
        flags.push('report_missing');
      }

      return {
        session: {
          id: row.id as string,
          inviteId: (row as { invite_id: string }).invite_id,
          kitVersionId: row.kit_version_id as string,
          mode: row.mode as 'text' | 'voice' | 'video',
          conductor: row.conductor as 'ai' | 'human',
          status: row.status as import('@zios/shared-types').SessionStatus,
          consentId: row.consent_id as string | null,
          preflightReport: row.preflight_report as Record<string, unknown>,
          startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
          endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
          mediaRefs: row.media_refs as unknown[],
          integrityEvents: row.integrity_events as unknown[],
          schemaVersion: row.schema_version as number,
          recoveryTokenHash: row.recovery_token_hash as string | null,
          createdAt: (row.created_at as Date).toISOString(),
          updatedAt: (row.updated_at as Date).toISOString(),
        },
        candidate: {
          id: row.candidate_id as string,
          orgId: row.candidate_org_id as string,
          name: row.candidate_name as string,
          email: row.candidate_email as string,
          phone: row.candidate_phone as string | null,
          externalRef: row.candidate_external_ref as string | null,
          piiVaultRef: row.candidate_pii_vault_ref as string | null,
          createdAt: (row.candidate_created_at as Date).toISOString(),
        },
        kitTitle: (row.kit_title as string) ?? '',
        reportStatus: (row.report_status as 'pending' | 'completed' | 'failed' | null) ?? null,
        overallRecommendation: (row.overall_recommendation as number | null) ?? null,
        flags,
      };
    });

    const totalPages = Math.ceil(total / size);
    return { items, page: pageNum, pageSize: size, total, totalPages };
  }
}
