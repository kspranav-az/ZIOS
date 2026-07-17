import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Kit, KitStatus } from '@zios/shared-types';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { kitsApi } from '../../lib/kits-api';
import { userMessageForError } from '../../lib/errors';
import { CreateKitDialog } from './CreateKitDialog';

/** /kits — kit list with status badges, search, and the create dialog (FR-E2-1). */

const STATUS_FILTERS: Array<{ value: KitStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

export function kitStatusTone(status: KitStatus): 'warning' | 'success' | 'neutral' {
  if (status === 'draft') return 'warning';
  if (status === 'published') return 'success';
  return 'neutral';
}

const MODE_ICONS: Record<string, string> = { text: 'chat', voice: 'mic', video: 'videocam' };

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function KitsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<KitStatus | 'all'>('all');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  // /kits?create=1 (e.g. "Start blank" from the template gallery) opens the
  // create dialog directly, then cleans the param off the URL.
  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setKits(null);
    setError(undefined);
    kitsApi
      .list(statusFilter === 'all' ? undefined : statusFilter)
      .then((response) => {
        if (!cancelled) setKits(response.kits);
      })
      .catch((err) => {
        if (!cancelled) setError(userMessageForError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter, reloadNonce]);

  const filtered = useMemo(() => {
    if (!kits) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return kits;
    return kits.filter(
      (kit) =>
        kit.title.toLowerCase().includes(needle) ||
        (kit.role ?? '').toLowerCase().includes(needle) ||
        (kit.level ?? '').toLowerCase().includes(needle),
    );
  }, [kits, search]);

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Interview Kits
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            Ordered, versioned interview definitions — publish once, reuse for every invite.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 self-start md:self-auto">
          <Button
            size="lg"
            variant="secondary"
            icon="dashboard_customize"
            onClick={() => navigate('/kits/new')}
          >
            Template gallery
          </Button>
          <Button size="lg" icon="add" onClick={() => setCreateOpen(true)}>
            New kit
          </Button>
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
            placeholder="Search by title, role or level..."
            type="search"
            aria-label="Search kits"
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
          <p className="font-label-bold text-label-bold text-primary">Could not load kits</p>
          <p className="text-sm text-on-surface-variant">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setReloadNonce((n) => n + 1)}>
            Try again
          </Button>
        </Card>
      ) : kits === null ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
          aria-label="Loading kits"
        >
          {[0, 1, 2].map((index) => (
            <Card key={index} className="animate-pulse">
              <div className="h-5 w-2/3 bg-surface-container rounded mb-3" />
              <div className="h-4 w-1/3 bg-surface-container rounded mb-6" />
              <div className="h-8 w-full bg-surface-container rounded" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-16 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
            <Icon name="assignment" className="text-2xl text-outline" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">
            {kits.length === 0 ? 'No kits yet' : 'No kits match your search'}
          </p>
          <p className="text-sm text-on-surface-variant mt-1 max-w-md">
            {kits.length === 0
              ? 'Create your first interview kit from scratch, or start from a ready-made template.'
              : 'Try a different search or status filter.'}
          </p>
          {kits.length === 0 && (
            <div className="flex gap-3 mt-2">
              <Button icon="add" onClick={() => setCreateOpen(true)}>
                New kit
              </Button>
              <Button variant="outline" onClick={() => navigate('/kits/new')}>
                Browse templates
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((kit) => (
            <Link
              key={kit.id}
              to={`/kits/${kit.id}`}
              className="block focus:outline-none focus-visible:ring-2 focus:ring-primary/40 rounded-2xl"
            >
              <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Icon
                      name={MODE_ICONS[kit.settings.mode] ?? 'assignment'}
                      className="text-primary"
                    />
                  </div>
                  <Badge tone={kitStatusTone(kit.status)}>{kit.status}</Badge>
                </div>
                <h3 className="font-headline-sm text-headline-sm text-primary leading-snug">
                  {kit.title}
                </h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  {[kit.role, kit.level].filter(Boolean).join(' · ') || 'Role not set yet'}
                </p>
                <div className="mt-5 pt-4 border-t border-surface-variant/50 flex items-center justify-between text-xs text-on-surface-variant">
                  <span className="flex items-center gap-1">
                    <Icon name="schedule" className="text-sm" />
                    Updated {formatUpdatedAt(kit.updatedAt)}
                  </span>
                  <span className="flex items-center gap-1 font-label-bold text-primary">
                    Open builder <Icon name="arrow_forward" className="text-sm" />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateKitDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
