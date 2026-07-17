import { useMemo, useState } from 'react';
import { Card, Icon } from '@zios/ui';

/**
 * Candidates — structure ported from the reference's
 * pages/Recruiter/Candidates.jsx (header + search/filter toolbar + table).
 * The roster data plane lands with the interviews phases; the table renders
 * its empty state until then.
 */

const STATUS_OPTIONS = ['All', 'Applied', 'Screening', 'Interview', 'Final Round', 'Hired'];

const COLUMNS = ['Candidate', 'Role Applied For', 'Interview Score', 'Status', 'Completion'];

export function CandidatesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filtered = useMemo(() => {
    // No candidate data source exists yet in Phase 01 — the filter pipeline
    // mirrors the reference so wiring real data later is drop-in.
    void search;
    void statusFilter;
    return [] as never[];
  }, [search, statusFilter]);

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Candidates
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            {filtered.length} of 0 candidates shown
          </p>
        </div>
      </section>

      {/* Search + filter toolbar */}
      <Card padding="md" className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg"
          />
          <input
            className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2.5 text-on-surface focus:ring-2 focus:ring-primary/10 transition-all font-body-md text-sm outline-none"
            placeholder="Search by candidate name..."
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-label-bold transition-colors ${
                statusFilter === status
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </Card>

      {/* Table */}
      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-variant/50">
                {COLUMNS.map((column) => (
                  <th
                    key={column}
                    className="px-6 py-4 text-xs font-label-bold uppercase tracking-wider text-on-surface-variant"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={COLUMNS.length} className="px-6 py-16">
                  <div className="flex flex-col items-center text-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                      <Icon name="group" className="text-2xl text-outline" />
                    </div>
                    <div>
                      <p className="font-label-bold text-label-bold text-primary">
                        No candidates yet
                      </p>
                      <p className="text-sm text-on-surface-variant mt-1">
                        Candidates appear here once you schedule your first interviews.
                      </p>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
