import { Injectable } from '@nestjs/common';
import type { ConsentRecord } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface ConsentRow {
  id: string;
  session_id: string | null;
  invite_id: string | null;
  subject_id: string;
  purpose: string;
  notice_version: string;
  captured_at: Date;
  artifact_uri: string | null;
  withdrawn_at: Date | null;
}

const COLUMNS =
  'id, session_id, invite_id, subject_id, purpose, notice_version, captured_at, artifact_uri, withdrawn_at';

function mapRow(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    inviteId: row.invite_id,
    subjectId: row.subject_id,
    purpose: row.purpose,
    noticeVersion: row.notice_version,
    capturedAt: row.captured_at.toISOString(),
    artifactUri: row.artifact_uri,
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
  };
}

@Injectable()
export class ConsentRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      sessionId?: string;
      inviteId?: string;
      subjectId: string;
      purpose: string;
      noticeVersion: string;
      artifactUri?: string;
    },
    q: Queryable,
  ): Promise<ConsentRecord> {
    const result = await q.query(
      `INSERT INTO consent_record (session_id, invite_id, subject_id, purpose, notice_version, artifact_uri)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        input.sessionId ?? null,
        input.inviteId ?? null,
        input.subjectId,
        input.purpose,
        input.noticeVersion,
        input.artifactUri ?? null,
      ],
    );
    return mapRow(result.rows[0] as ConsentRow);
  }

  async findById(id: string, q: Queryable = this.db): Promise<ConsentRecord | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM consent_record WHERE id = $1`, [id]);
    const row = result.rows[0] as ConsentRow | undefined;
    return row ? mapRow(row) : null;
  }

  async findBySessionId(sessionId: string, q: Queryable = this.db): Promise<ConsentRecord | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM consent_record WHERE session_id = $1 ORDER BY captured_at DESC LIMIT 1`,
      [sessionId],
    );
    return (result.rows[0] as ConsentRow | undefined) ? mapRow(result.rows[0] as ConsentRow) : null;
  }

  async findByInviteId(inviteId: string, q: Queryable = this.db): Promise<ConsentRecord | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM consent_record WHERE invite_id = $1 ORDER BY captured_at DESC LIMIT 1`,
      [inviteId],
    );
    return (result.rows[0] as ConsentRow | undefined) ? mapRow(result.rows[0] as ConsentRow) : null;
  }
}
