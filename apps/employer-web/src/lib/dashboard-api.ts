import type {
  DashboardInterviewItem,
  DashboardListResponse,
  SessionStatus,
} from '@zios/shared-types';
import { apiFetch } from './api';

export interface DashboardInterviewsFilters {
  status?: SessionStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Typed calls for the employer dashboard endpoints (Phase 04 pipeline view).
 */
export const dashboardApi = {
  listInterviews: (filters: DashboardInterviewsFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    if (filters.page && filters.page > 1) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
    const qs = params.toString();
    return apiFetch<DashboardListResponse>(`/dashboard/interviews${qs ? `?${qs}` : ''}`);
  },
};

/** Client-side filter used when the backend only paginates and the UI still
 * wants to narrow by status or free-text search. */
export function filterDashboardInterviews(
  items: DashboardInterviewItem[],
  filters: { status?: SessionStatus; q?: string },
): DashboardInterviewItem[] {
  const q = filters.q?.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status && item.session.status !== filters.status) return false;
    if (q) {
      const haystack =
        `${item.candidate.name} ${item.candidate.email} ${item.kitTitle}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
