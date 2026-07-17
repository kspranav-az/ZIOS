import { Injectable } from '@nestjs/common';
import type { SessionEvent } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface EventRow {
  id: string;
  session_id: string;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

const COLUMNS = 'id, session_id, type, payload, occurred_at';

function mapRow(row: EventRow): SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: row.payload,
    occurredAt: row.occurred_at.toISOString(),
  };
}

@Injectable()
export class EventsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: { sessionId: string; type: string; payload?: Record<string, unknown> },
    q: Queryable,
  ): Promise<SessionEvent> {
    const result = await q.query(
      `INSERT INTO session_event (session_id, type, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING ${COLUMNS}`,
      [input.sessionId, input.type, JSON.stringify(input.payload ?? {})],
    );
    return mapRow(result.rows[0] as EventRow);
  }

  async listBySession(sessionId: string, q: Queryable = this.db): Promise<SessionEvent[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM session_event WHERE session_id = $1 ORDER BY occurred_at ASC`,
      [sessionId],
    );
    return (result.rows as EventRow[]).map(mapRow);
  }
}
