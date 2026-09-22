import { apiFetch } from './api';

export type WebhookEvent = 'interview.completed' | 'report.ready';
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface WebhookEndpointView {
  id: string;
  orgId: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDeliveryView {
  id: string;
  endpointId: string;
  sessionEventId: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string;
  lastResponseCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/** Signing secret — present exactly once, right after endpoint creation. */
export interface CreatedWebhookEndpointView {
  endpoint: WebhookEndpointView;
  secret: string;
}

export function listWebhookEndpoints(): Promise<{ endpoints: WebhookEndpointView[] }> {
  return apiFetch('/webhooks/endpoints');
}

export function createWebhookEndpoint(input: {
  url: string;
  events: WebhookEvent[];
}): Promise<CreatedWebhookEndpointView> {
  return apiFetch('/webhooks/endpoints', { method: 'POST', json: input });
}

export function deactivateWebhookEndpoint(id: string): Promise<{ ok: true }> {
  return apiFetch(`/webhooks/endpoints/${encodeURIComponent(id)}/deactivate`, {
    method: 'POST',
    json: {},
  });
}

export function listWebhookDeliveries(filter?: {
  status?: WebhookDeliveryStatus;
  endpointId?: string;
}): Promise<{ deliveries: WebhookDeliveryView[] }> {
  const params = new URLSearchParams();
  if (filter?.status) params.set('status', filter.status);
  if (filter?.endpointId) params.set('endpointId', filter.endpointId);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return apiFetch(`/webhooks/deliveries${query}`);
}

export function replayWebhookDelivery(id: string): Promise<{ ok: true }> {
  return apiFetch(`/webhooks/deliveries/${encodeURIComponent(id)}/replay`, {
    method: 'POST',
    json: {},
  });
}
