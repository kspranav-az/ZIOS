import { Injectable } from '@nestjs/common';
import type { InterviewSlot, InterviewSlotStatus } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface InterviewSlotRow {
  id: string;
  org_id: string;
  invite_id: string;
  session_id: string | null;
  slot_at: Date;
  timezone: string;
  interviewer_ids: string[];
  status: string;
  reschedule_requested_at: Date | null;
  reschedule_reason: string | null;
  requested_slot_at: Date | null;
  ics_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, org_id, invite_id, session_id, slot_at, timezone, interviewer_ids, status, reschedule_requested_at, reschedule_reason, requested_slot_at, ics_sent_at, created_at, updated_at';

export function mapSlotRow(row: InterviewSlotRow): InterviewSlot {
  return {
    id: row.id,
    orgId: row.org_id,
    inviteId: row.invite_id,
    sessionId: row.session_id,
    slotAt: row.slot_at.toISOString(),
    timezone: row.timezone,
    interviewerIds: row.interviewer_ids,
    status: row.status as InterviewSlotStatus,
    rescheduleRequestedAt: row.reschedule_requested_at?.toISOString() ?? null,
    rescheduleReason: row.reschedule_reason,
    requestedSlotAt: row.requested_slot_at?.toISOString() ?? null,
    icsSentAt: row.ics_sent_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class InterviewSlotRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      orgId: string;
      inviteId: string;
      sessionId?: string | null;
      slotAt: Date;
      timezone?: string;
      interviewerIds?: string[];
    },
    q: Queryable,
  ): Promise<InterviewSlot> {
    const result = await q.query(
      `INSERT INTO interview_slot (org_id, invite_id, session_id, slot_at, timezone, interviewer_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.inviteId,
        input.sessionId ?? null,
        input.slotAt,
        input.timezone ?? 'UTC',
        input.interviewerIds ?? [],
      ],
    );
    return mapSlotRow(result.rows[0] as InterviewSlotRow);
  }

  async upsert(
    input: {
      orgId: string;
      inviteId: string;
      sessionId?: string | null;
      slotAt: Date;
      timezone?: string;
      interviewerIds?: string[];
    },
    q: Queryable,
  ): Promise<InterviewSlot> {
    const result = await q.query(
      `INSERT INTO interview_slot (org_id, invite_id, session_id, slot_at, timezone, interviewer_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (invite_id) DO UPDATE SET
         session_id = COALESCE(EXCLUDED.session_id, interview_slot.session_id),
         slot_at = EXCLUDED.slot_at,
         timezone = EXCLUDED.timezone,
         interviewer_ids = EXCLUDED.interviewer_ids,
         status = 'scheduled',
         updated_at = now()
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.inviteId,
        input.sessionId ?? null,
        input.slotAt,
        input.timezone ?? 'UTC',
        input.interviewerIds ?? [],
      ],
    );
    return mapSlotRow(result.rows[0] as InterviewSlotRow);
  }

  async findByInviteId(inviteId: string, q: Queryable = this.db): Promise<InterviewSlot | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM interview_slot WHERE invite_id = $1`, [
      inviteId,
    ]);
    const row = result.rows[0] as InterviewSlotRow | undefined;
    return row ? mapSlotRow(row) : null;
  }

  async findById(id: string, q: Queryable = this.db): Promise<InterviewSlot | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM interview_slot WHERE id = $1`, [id]);
    const row = result.rows[0] as InterviewSlotRow | undefined;
    return row ? mapSlotRow(row) : null;
  }

  async markRescheduleRequested(
    id: string,
    fields: { reason?: string; requestedSlotAt?: Date },
    q: Queryable,
  ): Promise<InterviewSlot | null> {
    const result = await q.query(
      `UPDATE interview_slot
       SET status = 'rescheduled',
           reschedule_requested_at = now(),
           reschedule_reason = $1,
           requested_slot_at = $2,
           updated_at = now()
       WHERE id = $3
       RETURNING ${COLUMNS}`,
      [fields.reason ?? null, fields.requestedSlotAt ?? null, id],
    );
    const row = result.rows[0] as InterviewSlotRow | undefined;
    return row ? mapSlotRow(row) : null;
  }

  async confirmReschedule(
    id: string,
    newSlotAt: Date,
    q: Queryable,
  ): Promise<InterviewSlot | null> {
    const result = await q.query(
      `UPDATE interview_slot
       SET slot_at = $1,
           status = 'scheduled',
           reschedule_requested_at = NULL,
           reschedule_reason = NULL,
           requested_slot_at = NULL,
           updated_at = now()
       WHERE id = $2
       RETURNING ${COLUMNS}`,
      [newSlotAt, id],
    );
    const row = result.rows[0] as InterviewSlotRow | undefined;
    return row ? mapSlotRow(row) : null;
  }

  async markIcsSent(id: string, q: Queryable): Promise<void> {
    await q.query(
      'UPDATE interview_slot SET ics_sent_at = now(), updated_at = now() WHERE id = $1',
      [id],
    );
  }

  async bindSessionId(id: string, sessionId: string, q: Queryable): Promise<void> {
    await q.query('UPDATE interview_slot SET session_id = $1, updated_at = now() WHERE id = $2', [
      sessionId,
      id,
    ]);
  }
}
