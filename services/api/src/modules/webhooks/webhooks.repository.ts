import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '@/modules/database';

export const WEBHOOK_EVENTS = ['interview.completed', 'report.ready'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookEndpoint {
  id: string;
  orgId: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  sessionEventId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextAttemptAt: string;
  lastResponseCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface EndpointRow {
  id: string;
  org_id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  created_at: Date;
}

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  session_event_id: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  next_attempt_at: Date;
  last_response_code: number | null;
  last_error: string | null;
  delivered_at: Date | null;
  created_at: Date;
}

const ENDPOINT_COLUMNS = 'id, org_id, url, secret, events, active, created_at';
const DELIVERY_COLUMNS =
  'id, endpoint_id, session_event_id, event, payload, status, attempts, next_attempt_at, last_response_code, last_error, delivered_at, created_at';

function mapEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    orgId: row.org_id,
    url: row.url,
    secret: row.secret,
    events: row.events as WebhookEvent[],
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

function mapDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    sessionEventId: row.session_event_id,
    event: row.event as WebhookEvent,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    lastResponseCode: row.last_response_code,
    lastError: row.last_error,
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class WebhooksRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertEndpoint(
    input: { orgId: string; url: string; secret: string; events: WebhookEvent[] },
    q: Queryable = this.db,
  ): Promise<WebhookEndpoint> {
    const result = await q.query(
      `INSERT INTO webhook_endpoint (org_id, url, secret, events)
       VALUES ($1, $2, $3, $4::text[])
       RETURNING ${ENDPOINT_COLUMNS}`,
      [input.orgId, input.url, input.secret, input.events],
    );
    return mapEndpoint(result.rows[0] as EndpointRow);
  }

  async listEndpoints(orgId: string, q: Queryable = this.db): Promise<WebhookEndpoint[]> {
    const result = await q.query(
      `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoint
       WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId],
    );
    return (result.rows as EndpointRow[]).map(mapEndpoint);
  }

  async findEndpointById(
    id: string,
    orgId: string,
    q: Queryable = this.db,
  ): Promise<WebhookEndpoint | null> {
    const result = await q.query(
      `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoint WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    const row = result.rows[0] as EndpointRow | undefined;
    return row ? mapEndpoint(row) : null;
  }

  async setActive(id: string, orgId: string, active: boolean): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE webhook_endpoint SET active = $3, updated_at = now()
       WHERE id = $1 AND org_id = $2 RETURNING id`,
      [id, orgId, active],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Active endpoints subscribed to `event` — the fanout fan-in query. */
  async listActiveSubscribed(event: WebhookEvent, q: Queryable): Promise<WebhookEndpoint[]> {
    const result = await q.query(
      `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoint
       WHERE active = true AND events @> ARRAY[$1]::text[]`,
      [event],
    );
    return (result.rows as EndpointRow[]).map(mapEndpoint);
  }

  /**
   * Durable delivery row inside the caller's transaction. ON CONFLICT DO
   * NOTHING: re-emitting the same session_event is a no-op (returns null).
   */
  async insertDelivery(
    input: {
      endpointId: string;
      sessionEventId: string;
      event: WebhookEvent;
      payload: Record<string, unknown>;
    },
    q: Queryable,
  ): Promise<WebhookDelivery | null> {
    const result = await q.query(
      `INSERT INTO webhook_delivery (endpoint_id, session_event_id, event, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (endpoint_id, session_event_id) DO NOTHING
       RETURNING ${DELIVERY_COLUMNS}`,
      [input.endpointId, input.sessionEventId, input.event, JSON.stringify(input.payload)],
    );
    const row = result.rows[0] as DeliveryRow | undefined;
    return row ? mapDelivery(row) : null;
  }

  async findDeliveryById(id: string, q: Queryable = this.db): Promise<WebhookDelivery | null> {
    const result = await q.query(`SELECT ${DELIVERY_COLUMNS} FROM webhook_delivery WHERE id = $1`, [
      id,
    ]);
    const row = result.rows[0] as DeliveryRow | undefined;
    return row ? mapDelivery(row) : null;
  }

  async listDeliveries(
    orgId: string,
    filter: { status?: 'pending' | 'delivered' | 'failed'; endpointId?: string } = {},
  ): Promise<WebhookDelivery[]> {
    const conditions = ['e.org_id = $1'];
    const params: unknown[] = [orgId];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`d.status = $${params.length}`);
    }
    if (filter.endpointId) {
      params.push(filter.endpointId);
      conditions.push(`d.endpoint_id = $${params.length}`);
    }
    const result = await this.db.query(
      `SELECT d.${DELIVERY_COLUMNS.replace(/, /g, ', d.')}
       FROM webhook_delivery d JOIN webhook_endpoint e ON e.id = d.endpoint_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.created_at DESC LIMIT 200`,
      params,
    );
    return (result.rows as DeliveryRow[]).map(mapDelivery);
  }

  async markAttempt(
    id: string,
    outcome: { responseCode: number | null; error: string | null },
    q: Queryable = this.db,
  ): Promise<void> {
    await q.query(
      `UPDATE webhook_delivery
       SET attempts = attempts + 1, last_response_code = $2, last_error = $3
       WHERE id = $1`,
      [id, outcome.responseCode, outcome.error],
    );
  }

  async scheduleRetry(id: string, nextAttemptAt: Date, q: Queryable = this.db): Promise<void> {
    await q.query(
      `UPDATE webhook_delivery SET next_attempt_at = $2, status = 'pending' WHERE id = $1`,
      [id, nextAttemptAt.toISOString()],
    );
  }

  async markDelivered(id: string, q: Queryable = this.db): Promise<void> {
    await q.query(
      `UPDATE webhook_delivery
       SET status = 'delivered', delivered_at = now(), last_error = NULL
       WHERE id = $1`,
      [id],
    );
  }

  async markFailed(id: string, q: Queryable = this.db): Promise<void> {
    await q.query(`UPDATE webhook_delivery SET status = 'failed' WHERE id = $1`, [id]);
  }

  /** Admin replay: reset attempts and make the row immediately deliverable. */
  async resetForReplay(id: string, q: Queryable = this.db): Promise<boolean> {
    const result = await q.query(
      `UPDATE webhook_delivery
       SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
       WHERE id = $1 RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
