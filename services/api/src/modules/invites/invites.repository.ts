import { Injectable } from '@nestjs/common';
import type { Invite, InviteStatus } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface InviteRow {
  id: string;
  org_id: string;
  kit_version_id: string;
  candidate_id: string;
  token_hash: string;
  expires_at: Date;
  otp_required: boolean;
  otp_verified_at: Date | null;
  status: string;
  metadata: Record<string, unknown>;
  reminder_48h_sent_at: Date | null;
  reminder_4h_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, org_id, kit_version_id, candidate_id, token_hash, expires_at, otp_required, otp_verified_at, status, metadata, reminder_48h_sent_at, reminder_4h_sent_at, created_at, updated_at';

function mapRow(row: InviteRow): Invite {
  return {
    id: row.id,
    orgId: row.org_id,
    kitVersionId: row.kit_version_id,
    candidateId: row.candidate_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    otpRequired: row.otp_required,
    otpVerifiedAt: row.otp_verified_at?.toISOString() ?? null,
    status: row.status as InviteStatus,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class InvitesRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      orgId: string;
      kitVersionId: string;
      candidateId: string;
      tokenHash: string;
      expiresAt: Date;
      otpRequired: boolean;
      metadata?: Record<string, unknown>;
    },
    q: Queryable,
  ): Promise<Invite> {
    const result = await q.query(
      `INSERT INTO invite (org_id, kit_version_id, candidate_id, token_hash, expires_at, otp_required, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.kitVersionId,
        input.candidateId,
        input.tokenHash,
        input.expiresAt,
        input.otpRequired,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapRow(result.rows[0] as InviteRow);
  }

  async findById(orgId: string, id: string, q: Queryable): Promise<Invite | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM invite WHERE id = $1 AND org_id = $2`, [
      id,
      orgId,
    ]);
    const row = result.rows[0] as InviteRow | undefined;
    return row ? mapRow(row) : null;
  }

  async findByTokenHash(tokenHash: string, q: Queryable): Promise<Invite | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM invite WHERE token_hash = $1`, [
      tokenHash,
    ]);
    const row = result.rows[0] as InviteRow | undefined;
    return row ? mapRow(row) : null;
  }

  async listByOrg(orgId: string, q: Queryable): Promise<Invite[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM invite WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId],
    );
    return (result.rows as InviteRow[]).map(mapRow);
  }

  async update(
    orgId: string,
    id: string,
    fields: {
      tokenHash?: string;
      expiresAt?: Date;
      status?: InviteStatus;
      otpVerifiedAt?: Date;
      metadata?: Record<string, unknown>;
    },
    q: Queryable,
  ): Promise<Invite | null> {
    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    if (fields.tokenHash !== undefined) {
      params.push(fields.tokenHash);
      sets.push(`token_hash = $${params.length}`);
    }
    if (fields.expiresAt !== undefined) {
      params.push(fields.expiresAt);
      sets.push(`expires_at = $${params.length}`);
    }
    if (fields.status !== undefined) {
      params.push(fields.status);
      sets.push(`status = $${params.length}`);
    }
    if (fields.otpVerifiedAt !== undefined) {
      params.push(fields.otpVerifiedAt);
      sets.push(`otp_verified_at = $${params.length}`);
    }
    if (fields.metadata !== undefined) {
      params.push(JSON.stringify(fields.metadata));
      sets.push(`metadata = $${params.length}::jsonb`);
    }
    params.push(id, orgId);
    const result = await q.query(
      `UPDATE invite SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND org_id = $${params.length}
       RETURNING ${COLUMNS}`,
      params,
    );
    const row = result.rows[0] as InviteRow | undefined;
    return row ? mapRow(row) : null;
  }

  async setReminderSent(id: string, window: '48h' | '4h', q: Queryable): Promise<void> {
    const column = window === '48h' ? 'reminder_48h_sent_at' : 'reminder_4h_sent_at';
    await q.query(`UPDATE invite SET ${column} = now() WHERE id = $1`, [id]);
  }

  /** Used by the reminder cron: pending invites that have not yet opted out. */
  async findPendingForReminders(q: Queryable = this.db): Promise<
    (Invite & {
      candidateEmail: string;
      candidateName: string;
      reminder48hSentAt: string | null;
      reminder4hSentAt: string | null;
    })[]
  > {
    const result = await q.query(
      `SELECT i.${COLUMNS.replace(/, /g, ', i.')},
              c.email AS candidate_email,
              c.name AS candidate_name,
              i.reminder_48h_sent_at,
              i.reminder_4h_sent_at
       FROM invite i
       JOIN candidate c ON c.id = i.candidate_id
       LEFT JOIN email_opt_out opt ON opt.email = c.email
       WHERE i.status = 'invited'
         AND i.expires_at > now()
         AND opt.email IS NULL
       ORDER BY i.expires_at ASC`,
    );
    return result.rows.map((row) => {
      const r = row as InviteRow & {
        candidate_email: string;
        candidate_name: string;
        reminder_48h_sent_at: Date | null;
        reminder_4h_sent_at: Date | null;
      };
      return {
        ...mapRow(r),
        candidateEmail: r.candidate_email,
        candidateName: r.candidate_name,
        reminder48hSentAt: r.reminder_48h_sent_at?.toISOString() ?? null,
        reminder4hSentAt: r.reminder_4h_sent_at?.toISOString() ?? null,
      };
    });
  }
}
