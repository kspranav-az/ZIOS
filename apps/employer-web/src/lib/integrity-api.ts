import type {
  CreateDispositionBody,
  IntegrityFlag,
  IntegrityFlagsResponse,
} from '@zios/shared-types';
import { apiFetch } from './api';

export const integrityApi = {
  listFlags: (sessionId: string) =>
    apiFetch<IntegrityFlagsResponse>(`/sessions/${encodeURIComponent(sessionId)}/integrity/flags`),

  dispositionFlag: (sessionId: string, flagId: string, body: CreateDispositionBody) =>
    apiFetch<{ flag: IntegrityFlag }>(
      `/sessions/${encodeURIComponent(sessionId)}/integrity/flags/${encodeURIComponent(flagId)}/disposition`,
      { method: 'POST', json: body },
    ),
};
