import type {
  CreateShareLinkBody,
  CreateShareLinkResponse,
  EvaluationStatus,
  OverrideScoreBody,
  PublicReportResponse,
  ReportDetailResponse,
  ReportListResponse,
  ScoreOverride,
} from '@zios/shared-types';
import { apiFetch } from './api';

export interface ReportListFilters {
  status?: EvaluationStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Typed calls for the evaluation report endpoints (Phase 04 — evidence-linked
 * scoring, overrides, share links, and public read-only views).
 */
export const reportsApi = {
  list: (filters: ReportListFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    if (filters.page && filters.page > 1) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
    const qs = params.toString();
    return apiFetch<ReportListResponse>(`/reports${qs ? `?${qs}` : ''}`);
  },

  getDetail: (sessionId: string) => apiFetch<ReportDetailResponse>(`/reports/${sessionId}`),

  overrideScore: (sessionId: string, scoreId: string, body: OverrideScoreBody) =>
    apiFetch<{ override: ScoreOverride }>(`/reports/${sessionId}/scores/${scoreId}/override`, {
      method: 'POST',
      json: body,
    }),

  createShareLink: (sessionId: string, body: CreateShareLinkBody = {}) =>
    apiFetch<CreateShareLinkResponse>(`/reports/${sessionId}/share`, {
      method: 'POST',
      json: body,
    }),

  /** Public endpoint — no auth cookie required. */
  getShared: (token: string) =>
    apiFetch<PublicReportResponse>(`/reports/share/${encodeURIComponent(token)}`),
};
