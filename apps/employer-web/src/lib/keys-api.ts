import { apiFetch } from './api';

export interface ApiKeyView {
  id: string;
  kind: 'test' | 'live';
  prefix: string;
  label: string | null;
  scopes: string[];
  rateLimitPerMin: number;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

/** Full key material — present exactly once, right after create/rotate. */
export interface CreatedApiKeyView extends ApiKeyView {
  key: string;
}

export function listApiKeys(kind?: 'test' | 'live'): Promise<{ keys: ApiKeyView[] }> {
  const query = kind ? `?kind=${kind}` : '';
  return apiFetch(`/integration-api/keys${query}`);
}

export function createApiKey(input: {
  kind: 'test' | 'live';
  label?: string;
  rateLimitPerMin?: number;
}): Promise<CreatedApiKeyView> {
  return apiFetch('/integration-api/keys', { method: 'POST', json: input });
}

export function rotateApiKey(id: string): Promise<CreatedApiKeyView> {
  return apiFetch(`/integration-api/keys/${encodeURIComponent(id)}/rotate`, {
    method: 'POST',
    json: {},
  });
}

export function revokeApiKey(id: string): Promise<ApiKeyView> {
  return apiFetch(`/integration-api/keys/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    json: {},
  });
}
