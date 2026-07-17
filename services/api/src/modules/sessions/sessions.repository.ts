import { Injectable } from '@nestjs/common';
import type { InterviewSession, SessionStatus } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface InterviewSessionRow {
  id: string;
  invite_id: string;
  kit_version_id: string;
  mode: string;
  conductor: string;
  status: string;
  consent_id: string | null;
  preflight_report: Record<string, unknown>;
  started_at: Date | null;
  ended_at: Date | null;
  media_refs: unknown[];
  integrity_events: unknown[];
  schema_version: number;
  recovery_token_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, invite_id, kit_version_id, mode, conductor, status, consent_id, preflight_report, started_at, ended_at, media_refs, integrity_events, schema_version, recovery_token_hash, created_at, updated_at';

function mapRow(row: InterviewSessionRow): InterviewSession {
  return {
    id: row.id,
    inviteId: row.invite_id,
    kitVersionId: row.kit_version_id,
    mode: row.mode as InterviewSession['mode'],
    conductor: row.conductor as InterviewSession['conductor'],
    status: row.status as InterviewSession['status'],
    consentId: row.consent_id,
    preflightReport: row.preflight_report,
    startedAt: row.started_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    mediaRefs: row.media_refs,
    integrityEvents: row.integrity_events,
    schemaVersion: row.schema_version,
    recoveryTokenHash: row.recovery_token_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class SessionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      inviteId: string;
      kitVersionId: string;
      mode: InterviewSession['mode'];
      conductor?: InterviewSession['conductor'];
      status: SessionStatus;
      consentId?: string;
      recoveryTokenHash?: string;
    },
    q: Queryable,
  ): Promise<InterviewSession> {
    const result = await q.query(
      `INSERT INTO interview_session (invite_id, kit_version_id, mode, conductor, status, consent_id, recovery_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        input.inviteId,
        input.kitVersionId,
        input.mode,
        input.conductor ?? 'ai',
        input.status,
        input.consentId ?? null,
        input.recoveryTokenHash ?? null,
      ],
    );
    return mapRow(result.rows[0] as InterviewSessionRow);
  }

  async findById(id: string, q: Queryable = this.db): Promise<InterviewSession | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM interview_session WHERE id = $1`, [id]);
    return (result.rows[0] as InterviewSessionRow | undefined)
      ? mapRow(result.rows[0] as InterviewSessionRow)
      : null;
  }

  async findByInviteId(inviteId: string, q: Queryable = this.db): Promise<InterviewSession | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM interview_session WHERE invite_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [inviteId],
    );
    return (result.rows[0] as InterviewSessionRow | undefined)
      ? mapRow(result.rows[0] as InterviewSessionRow)
      : null;
  }

  async findByRecoveryTokenHash(
    hash: string,
    q: Queryable = this.db,
  ): Promise<InterviewSession | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM interview_session WHERE recovery_token_hash = $1`,
      [hash],
    );
    return (result.rows[0] as InterviewSessionRow | undefined)
      ? mapRow(result.rows[0] as InterviewSessionRow)
      : null;
  }

  async updateStatus(
    id: string,
    status: SessionStatus,
    q: Queryable,
    extras?: { startedAt?: Date; endedAt?: Date; preflightReport?: Record<string, unknown> },
  ): Promise<InterviewSession | null> {
    const sets: string[] = ['status = $1', 'updated_at = now()'];
    const params: unknown[] = [status];
    if (extras?.startedAt !== undefined) {
      params.push(extras.startedAt);
      sets.push(`started_at = $${params.length}`);
    }
    if (extras?.endedAt !== undefined) {
      params.push(extras.endedAt);
      sets.push(`ended_at = $${params.length}`);
    }
    if (extras?.preflightReport !== undefined) {
      params.push(JSON.stringify(extras.preflightReport));
      sets.push(`preflight_report = $${params.length}::jsonb`);
    }
    params.push(id);
    const result = await q.query(
      `UPDATE interview_session SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    );
    return (result.rows[0] as InterviewSessionRow | undefined)
      ? mapRow(result.rows[0] as InterviewSessionRow)
      : null;
  }

  async setConsentId(id: string, consentId: string, q: Queryable): Promise<void> {
    await q.query(
      'UPDATE interview_session SET consent_id = $1, updated_at = now() WHERE id = $2',
      [consentId, id],
    );
  }
}
