import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Icon } from '@zios/ui';
import type { InviteListItem, InviteStatus } from '@zios/shared-types';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { userMessageForError } from '../../lib/errors';
import { invitesApi } from '../../lib/invites-api';
import { SendInterviewDialog, LinkSuccess } from './SendInterviewDialog';

/**
 * Candidates — the invite roster (D6). The table lists candidate INVITES
 * (newest first): candidate identity, kit title/version, invite status,
 * expiry, and lifecycle actions. There is deliberately no separate
 * "candidates" abstraction — `invite` already tracks the full lifecycle.
 */

const STATUS_FILTERS: Array<{ value: InviteStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'invited', label: 'Invited' },
  { value: 'started', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_TONE: Record<InviteStatus, string> = {
  invited: 'bg-surface-container-high text-on-surface-variant',
  started: 'bg-primary/10 text-primary',
  completed: 'bg-success/10 text-success',
  expired: 'bg-surface-container-low text-outline border border-outline-variant/50',
};

const STATUS_LABEL: Record<InviteStatus, string> = {
  invited: 'Invited',
  started: 'In progress',
  completed: 'Completed',
  expired: 'Expired',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isExpiringSoon(value: string): boolean {
  const ms = new Date(value).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 && ms < 48 * 3_600_000;
}

/** Copy-once modal shown after a reissue — the new token exists only here. */
interface ReissuedLink {
  email: string;
  token: string;
}

export function CandidatesPage() {
  const { push: toast } = useToast();
  const [invites, setInvites] = useState<InviteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InviteStatus | 'all'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    { type: 'extend' | 'reissue'; invite: InviteListItem } | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [reissued, setReissued] = useState<ReissuedLink | null>(null);
  const [detailFor, setDetailFor] = useState<InviteListItem | null>(null);
  const [detailText, setDetailText] = useState<string>();

  const load = useCallback(async () => {
    try {
      const res = await invitesApi.list();
      setInvites(res.invites);
      setLoadError(undefined);
    } catch (err) {
      setLoadError(userMessageForError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invites.filter((invite) => {
      if (statusFilter !== 'all' && invite.status !== statusFilter) return false;
      if (!term) return true;
      return (
        invite.candidate.name.toLowerCase().includes(term) ||
        invite.candidate.email.toLowerCase().includes(term) ||
        invite.kit.title.toLowerCase().includes(term)
      );
    });
  }, [invites, search, statusFilter]);

  async function handleExtend(invite: InviteListItem) {
    setActionBusy(true);
    try {
      await invitesApi.reschedule(invite.id, { extendDays: 7 });
      toast(`Link for ${invite.candidate.name} extended by 7 days.`, 'success');
      await load();
    } catch (err) {
      toast(userMessageForError(err), 'error');
    } finally {
      setActionBusy(false);
      setConfirmAction(null);
    }
  }

  async function handleReissueConfirm(invite: InviteListItem) {
    setActionBusy(true);
    try {
      const res = await invitesApi.reissue(invite.id);
      setConfirmAction(null);
      setReissued({ email: res.candidate.email, token: res.token });
      toast(`New link issued for ${res.candidate.name}.`, 'success');
      await load();
    } catch (err) {
      toast(userMessageForError(err), 'error');
    } finally {
      setActionBusy(false);
    }
  }

  function runConfirmAction() {
    if (!confirmAction) return;
    if (confirmAction.type === 'extend') {
      void handleExtend(confirmAction.invite);
    } else {
      void handleReissueConfirm(confirmAction.invite);
    }
  }

  async function openDetail(invite: InviteListItem) {
    setDetailFor(invite);
    setDetailText(undefined);
    try {
      const res = await invitesApi.detail(invite.id);
      const lines = [
        `Kit: ${res.kitVersion ? `v${res.kitVersion.version}` : invite.kit.title}`,
        res.kitVersion?.publishedAt ? `Published: ${formatDate(res.kitVersion.publishedAt)}` : null,
        `OTP required: ${res.invite.otpRequired ? 'yes' : 'no'}`,
        `OTP verified: ${res.invite.otpVerifiedAt ? formatDate(res.invite.otpVerifiedAt) : 'no'}`,
        `Created: ${formatDate(res.invite.createdAt)}`,
        res.candidate.phone ? `Phone: ${res.candidate.phone}` : null,
        res.candidate.externalRef ? `External ref: ${res.candidate.externalRef}` : null,
      ].filter(Boolean);
      setDetailText(lines.join('\n'));
    } catch (err) {
      setDetailText(userMessageForError(err));
    }
  }

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            Candidates
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            {visible.length} of {invites.length} invites shown
          </p>
        </div>
        <Button icon="send" onClick={() => setDialogOpen(true)}>
          Send interview
        </Button>
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
            placeholder="Search by name, email, or kit…"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-label-bold transition-colors ${
                statusFilter === value
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {/* Roster table */}
      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-surface-variant/50">
                {['Candidate', 'Kit', 'Status', 'Expires', 'Actions'].map((column) => (
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
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-on-surface-variant">
                    Loading invites…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-error">
                    {loadError}
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16">
                    <div className="flex flex-col items-center text-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                        <Icon name="group" className="text-2xl text-outline" />
                      </div>
                      <div>
                        <p className="font-label-bold text-label-bold text-primary">
                          {invites.length === 0 ? 'No invites yet' : 'No invites match your filters'}
                        </p>
                        <p className="text-sm text-on-surface-variant mt-1">
                          {invites.length === 0
                            ? 'Send your first interview invite and the candidate appears here.'
                            : 'Try a different search term or status filter.'}
                        </p>
                        {invites.length === 0 && (
                          <Button
                            className="mt-4"
                            icon="send"
                            onClick={() => setDialogOpen(true)}
                          >
                            Send interview
                          </Button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                visible.map((invite) => (
                  <tr key={invite.id} className="border-b border-surface-variant/30 last:border-0">
                    <td className="px-6 py-4">
                      <p className="font-bold text-on-surface">{invite.candidate.name}</p>
                      <p className="text-sm text-on-surface-variant">{invite.candidate.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-on-surface">{invite.kit.title}</p>
                      <p className="text-sm text-on-surface-variant">v{invite.kit.version}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-label-bold ${STATUS_TONE[invite.status]}`}
                      >
                        {STATUS_LABEL[invite.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={
                          isExpiringSoon(invite.expiresAt) ? 'text-error font-bold' : 'text-on-surface'
                        }
                      >
                        {formatDate(invite.expiresAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Issue a new link (invalidates the old one)"
                          onClick={() => setConfirmAction({ type: 'reissue', invite })}
                          className="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                        >
                          <Icon name="link" />
                        </button>
                        <button
                          type="button"
                          title="Extend expiry by 7 days"
                          onClick={() => setConfirmAction({ type: 'extend', invite })}
                          className="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                        >
                          <Icon name="schedule" />
                        </button>
                        <button
                          type="button"
                          title="View details"
                          onClick={() => void openDetail(invite)}
                          className="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                        >
                          <Icon name="visibility" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <SendInterviewDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSent={() => void load()} />

      {/* Lifecycle action confirmation (extend / reissue) */}
      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction?.type === 'extend'
            ? `Extend link for ${confirmAction.invite.candidate.name}?`
            : `Issue a new link for ${confirmAction?.invite.candidate.name ?? ''}?`
        }
        description={
          confirmAction?.type === 'extend'
            ? 'The invite link stays valid for 7 more days. The candidate uses the same link.'
            : 'The old link stops working immediately and the candidate gets a new link by email.'
        }
        confirmLabel={confirmAction?.type === 'extend' ? 'Extend by 7 days' : 'Issue new link'}
        busy={actionBusy}
        onConfirm={runConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Reissue → copy-once new link (D4) */}
      {reissued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-surface-container-lowest rounded-3xl shadow-xl border border-surface-variant/50 p-8">
            <LinkSuccess
              title="New link issued"
              description={
                <>
                  The old link for <span className="font-bold text-on-surface">{reissued.email}</span>{' '}
                  no longer works. A new email is on its way.
                </>
              }
              links={[{ token: reissued.token, label: reissued.email }]}
              onDone={() => setReissued(null)}
              onSendAnother={() => setReissued(null)}
            />
          </div>
        </div>
      )}

      {/* Detail slide-over */}
      {detailFor && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDetailFor(null);
          }}
        >
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-surface-container-lowest shadow-xl p-8 space-y-6 overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-headline-sm font-headline-sm text-primary">
                  {detailFor.candidate.name}
                </h3>
                <p className="text-sm text-on-surface-variant">{detailFor.candidate.email}</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDetailFor(null)}
                className="p-1 text-on-surface-variant hover:text-primary transition-colors"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="rounded-2xl bg-surface-container p-4">
              <p className="text-xs font-label-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Invite details
              </p>
              <p className="text-sm text-on-surface whitespace-pre-line">
                {detailText ?? 'Loading…'}
              </p>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setDetailFor(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
