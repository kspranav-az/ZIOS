import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardInterviewItem, SessionStatus } from '@zios/shared-types';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { dashboardApi, filterDashboardInterviews } from '../../lib/dashboard-api';
import { userMessageForError } from '../../lib/errors';
import {
  dashboardRowOverall,
  formatDate,
  MODE_ICONS,
  SESSION_STATUS_LABELS,
  sessionStatusTone,
} from './report-utils';

/** /interviews — employer-facing interview pipeline dashboard (Phase 04). */

const STATUS_FILTERS: Array<{ value: SessionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'invited', label: 'Invited' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Completed' },
  { value: 'reported', label: 'Reported' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'abandoned', label: 'Abandoned' },
];

const PAGE_SIZE = 20;

export function InterviewsListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DashboardInterviewItem[] | null>(null);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(undefined);
    dashboardApi
      .listInterviews({ page, pageSize: PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setItems(response.items);
        setTotalPages(response.totalPages);
      })
      .catch((err) => {
        if (!cancelled) setError(userMessageForError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [page, reloadNonce]);

  const filtered = useMemo(
    () =>
      filterDashboardInterviews(items ?? [], {
        status: statusFilter === 'all' ? undefined : statusFilter,
        q: search,
      }),
    [items, statusFilter, search],
  );

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Interviews
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            Track candidates through the interview pipeline and open evidence-linked reports.
          </p>
        </div>
      </section>

      {/* Search + status filter toolbar */}
      <Card padding="md" className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg"
          />
          <input
            className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2.5 text-on-surface focus:ring-2 focus:ring-primary/10 transition-all font-body-md text-sm outline-none"
            placeholder="Search by candidate, email, or kit..."
            type="search"
            aria-label="Search interviews"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-label-bold transition-colors ${
                statusFilter === filter.value
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Content states */}
      {error ? (
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name="error" className="text-2xl text-error" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">Could not load interviews</p>
          <p className="text-sm text-on-surface-variant">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setReloadNonce((n) => n + 1)}>
            Try again
          </Button>
        </Card>
      ) : items === null ? (
        <Card>
          <div className="animate-pulse space-y-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-12 bg-surface-container rounded" />
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-16 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
            <Icon name="event_available" className="text-2xl text-outline" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">
            {items.length === 0 ? 'No interviews yet' : 'No interviews match your filters'}
          </p>
          <p className="text-sm text-on-surface-variant mt-1 max-w-md">
            {items.length === 0
              ? 'Invite candidates to a kit to see them here.'
              : 'Try a different search term or status filter.'}
          </p>
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-high text-on-surface-variant text-xs font-label-bold uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Candidate</th>
                  <th className="px-6 py-4">Kit</th>
                  <th className="px-6 py-4">Mode</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Overall</th>
                  <th className="px-6 py-4">Flags</th>
                  <th className="px-6 py-4">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/50">
                {filtered.map((item) => {
                  const overall = dashboardRowOverall(item);
                  return (
                    <tr
                      key={item.session.id}
                      onClick={() =>
                        navigate(
                          item.isAsyncVideo
                            ? `/interviews/${item.session.id}/async-review`
                            : `/interviews/${item.session.id}`,
                        )
                      }
                      className="hover:bg-surface-container-low cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="font-label-bold text-primary">{item.candidate.name}</div>
                        <div className="text-sm text-on-surface-variant">
                          {item.candidate.email}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface">{item.kitTitle}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
                          <Icon
                            name={MODE_ICONS[item.session.mode] ?? 'chat'}
                            className="text-sm"
                          />
                          <span className="capitalize">{item.session.mode}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge tone={sessionStatusTone(item.session.status)}>
                          {SESSION_STATUS_LABELS[item.session.status]}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-headline-sm text-headline-sm text-primary">
                            {overall.value}
                          </span>
                          <span className="text-xs text-on-surface-variant">{overall.label}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {item.flags.length === 0 ? (
                            <span className="text-sm text-on-surface-variant">—</span>
                          ) : (
                            item.flags.map((flag) => (
                              <Badge key={flag} tone="warning" className="text-[10px]">
                                {flag.replace(/_/g, ' ')}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {formatDate(item.session.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-surface-variant/50 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                icon="chevron_left"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-on-surface-variant">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <Icon name="chevron_right" className="text-sm ml-1" />
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
