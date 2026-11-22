import type {
  BulkInviteResponse,
  CreateCandidateInviteBody,
  CreateCandidateInviteResponse,
  InviteDetailResponse,
  InviteListResponse,
  RescheduleInviteBody,
} from '@zios/shared-types';
import { apiFetch } from './api';

/** Base URL of the candidate web app — used to build copyable entry links. */
export const CANDIDATE_BASE_URL: string =
  import.meta.env.VITE_CANDIDATE_BASE_URL ?? 'http://localhost:5174';

/** The full candidate entry link for a raw invite token (D4). */
export function candidateLink(token: string): string {
  return `${CANDIDATE_BASE_URL}/?token=${encodeURIComponent(token)}`;
}

/**
 * Typed calls for the candidate-invite endpoints (FR-E2 — see
 * services/api/src/modules/invites/README.md). The raw token is returned by
 * create/reissue exactly once; the UI shows it copy-once and never stores it.
 */
export const invitesApi = {
  list: () => apiFetch<InviteListResponse>('/invites'),

  detail: (id: string) => apiFetch<InviteDetailResponse>(`/invites/${id}`),

  create: (body: CreateCandidateInviteBody) =>
    apiFetch<CreateCandidateInviteResponse>('/invites', { method: 'POST', json: body }),

  /** Multipart upload — the file rides in `file`, the kit binding in the query. */
  bulk: (kitVersionId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch<BulkInviteResponse>(
      `/invites/bulk?kitVersionId=${encodeURIComponent(kitVersionId)}`,
      { method: 'POST', formData },
    );
  },

  reissue: (id: string) =>
    apiFetch<CreateCandidateInviteResponse>(`/invites/${id}/reissue`, { method: 'POST', json: {} }),

  reschedule: (id: string, body: RescheduleInviteBody) =>
    apiFetch<InviteDetailResponse['invite']>(`/invites/${id}/reschedule`, {
      method: 'POST',
      json: body,
    }),
};
