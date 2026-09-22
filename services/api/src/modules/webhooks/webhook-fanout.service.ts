import { Injectable } from '@nestjs/common';
import type { Queryable } from '@/modules/database';
import { WebhooksRepository, type WebhookDelivery, type WebhookEvent } from './webhooks.repository';

/**
 * Payload envelope stored on webhook_delivery.payload (jsonb). The delivery
 * worker wraps it as `{ id: delivery.id, ...payload }` at send time — the
 * contract test snapshots that exact shape.
 */
export interface WebhookPayloadEnvelope {
  event: WebhookEvent;
  occurred_at: string;
  data: {
    interview_id: string;
    session_id: string;
    external_ref: string | null;
    candidate: { name: string; email: string; external_ref: string | null };
  };
  links: {
    interview: string;
    scorecard: string;
  };
}

function publicApiBase(): string {
  return (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

interface SessionContextRow {
  org_id: string;
  external_interview_id: string | null;
  external_ref: string | null;
  candidate_name: string;
  candidate_email: string;
  candidate_external_ref: string | null;
}

@Injectable()
export class WebhookFanoutService {
  constructor(private readonly webhooks: WebhooksRepository) {}

  /**
   * Writes one durable webhook_delivery row per subscribed active endpoint,
   * inside the caller's transaction. Dedupe is the
   * (endpoint_id, session_event_id) unique constraint: re-emitting the same
   * session_event returns no new rows. The caller enqueues BullMQ jobs for
   * the returned ids only after commit.
   */
  async fanout(
    q: Queryable,
    input: {
      sessionEventId: string;
      sessionId: string;
      inviteId: string;
      event: WebhookEvent;
      occurredAt: Date;
    },
  ): Promise<WebhookDelivery[]> {
    const context = await this.loadSessionContext(q, input.inviteId);
    const endpoints = await this.webhooks.listActiveSubscribed(input.event, q);
    const delivered: WebhookDelivery[] = [];
    for (const endpoint of endpoints) {
      const interviewId = context.external_interview_id ?? input.sessionId;
      const payload: WebhookPayloadEnvelope = {
        event: input.event,
        occurred_at: input.occurredAt.toISOString(),
        data: {
          interview_id: interviewId,
          session_id: input.sessionId,
          external_ref: context.external_ref,
          candidate: {
            name: context.candidate_name,
            email: context.candidate_email,
            external_ref: context.candidate_external_ref,
          },
        },
        links: {
          interview: `${publicApiBase()}/v1/interviews/${interviewId}`,
          scorecard: `${publicApiBase()}/v1/interviews/${interviewId}/scorecard`,
        },
      };
      const row = await this.webhooks.insertDelivery(
        {
          endpointId: endpoint.id,
          sessionEventId: input.sessionEventId,
          event: input.event,
          payload: payload as unknown as Record<string, unknown>,
        },
        q,
      );
      if (row) delivered.push(row);
    }
    return delivered;
  }

  private async loadSessionContext(q: Queryable, inviteId: string): Promise<SessionContextRow> {
    const result = await q.query(
      `SELECT i.org_id,
              ei.id AS external_interview_id,
              ei.external_ref,
              c.name AS candidate_name,
              c.email::text AS candidate_email,
              c.external_ref AS candidate_external_ref
       FROM invite i
       JOIN candidate c ON c.id = i.candidate_id
       LEFT JOIN external_interview ei ON ei.invite_id = i.id
       WHERE i.id = $1`,
      [inviteId],
    );
    const row = result.rows[0] as SessionContextRow | undefined;
    if (!row) {
      throw new Error(`invite ${inviteId} not found during webhook fanout`);
    }
    return row;
  }
}
