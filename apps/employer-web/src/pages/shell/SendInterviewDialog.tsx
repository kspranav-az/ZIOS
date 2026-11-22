import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  BulkInviteResponse,
  CreateCandidateInviteResponse,
  Kit,
  KitVersionSummary,
} from '@zios/shared-types';
import { Button, Icon, Input } from '@zios/ui';
import { userMessageForError } from '../../lib/errors';
import { kitsApi } from '../../lib/kits-api';
import { candidateLink, invitesApi } from '../../lib/invites-api';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CSV_TEMPLATE = 'name,email,phone,external_ref\n';

type Tab = 'single' | 'bulk';

export interface SendInterviewDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful create/bulk so the roster can refetch. */
  onSent?: () => void;
}

/**
 * Candidate invite dialog (D2/D3/D8): one entry point with two tabs —
 * single candidate form and bulk CSV upload. Both bind to a published kit
 * VERSION (immutable snapshot, FR-E2-5). On success the raw token is shown
 * exactly once with a copy button (D4): hash-only storage means the link
 * can never be re-displayed, only reissued.
 */
export function SendInterviewDialog({ open, onClose, onSent }: SendInterviewDialogProps) {
  const [tab, setTab] = useState<Tab>('single');
  const [kits, setKits] = useState<Kit[]>([]);
  const [kitId, setKitId] = useState('');
  const [versions, setVersions] = useState<KitVersionSummary[]>([]);
  const [kitVersionId, setKitVersionId] = useState('');
  const [kitsError, setKitsError] = useState<string>();

  // Single-tab fields.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('7');

  // Bulk-tab fields.
  const [file, setFile] = useState<File | null>(null);

  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [singleResult, setSingleResult] = useState<CreateCandidateInviteResponse | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkInviteResponse | null>(null);
  const [showBulkLinks, setShowBulkLinks] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const selectableKits = useMemo(() => kits.filter((k) => k.status !== 'archived'), [kits]);
  const latestVersion = useMemo(
    () =>
      versions.reduce<KitVersionSummary | null>(
        (acc, v) => (acc === null || v.version > acc.version ? v : acc),
        null,
      ),
    [versions],
  );

  useEffect(() => {
    if (!open) return undefined;
    setTab('single');
    setKitId('');
    setKitVersionId('');
    setVersions([]);
    setKitsError(undefined);
    setName('');
    setEmail('');
    setPhone('');
    setExternalRef('');
    setExpiresInDays('7');
    setFile(null);
    setError(undefined);
    setSubmitting(false);
    setSingleResult(null);
    setBulkResult(null);
    setShowBulkLinks(false);

    let cancelled = false;
    kitsApi
      .list()
      .then((res) => {
        if (!cancelled) setKits(res.kits);
      })
      .catch((err: unknown) => {
        if (!cancelled) setKitsError(userMessageForError(err));
      });

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEscape);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, onClose]);

  // Version picker follows the kit picker (D3: published versions only —
  // the versions endpoint only lists published snapshots).
  useEffect(() => {
    if (!kitId) {
      setVersions([]);
      setKitVersionId('');
      return;
    }
    let cancelled = false;
    kitsApi
      .listVersions(kitId)
      .then((res) => {
        if (cancelled) return;
        setVersions(res.versions);
        const latest = res.versions.reduce<KitVersionSummary | null>(
          (acc, v) => (acc === null || v.version > acc.version ? v : acc),
          null,
        );
        setKitVersionId(latest?.id ?? '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(userMessageForError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [kitId]);

  const bulkSuccessRows = useMemo(
    () => (bulkResult?.results ?? []).filter((r) => r.token),
    [bulkResult],
  );

  if (!open) return null;

  function validateKitSelection(): boolean {
    if (!kitId || !kitVersionId) {
      setError('Select a kit and a published version first.');
      return false;
    }
    return true;
  }

  async function handleSingleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validateKitSelection()) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName) {
      setError('Candidate name is required.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError('Please enter a valid candidate email address.');
      return;
    }
    const days = Number.parseInt(expiresInDays, 10);
    setError(undefined);
    setSubmitting(true);
    try {
      const res = await invitesApi.create({
        kitVersionId,
        candidate: {
          name: trimmedName,
          email: trimmedEmail,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
        },
        ...(Number.isInteger(days) && days > 0 ? { expiresInDays: days } : {}),
      });
      setSingleResult(res);
      onSent?.();
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validateKitSelection()) return;
    if (!file) {
      setError('Choose a CSV file first.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      const res = await invitesApi.bulk(kitVersionId, file);
      setBulkResult(res);
      setShowBulkLinks(false);
      onSent?.();
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setSubmitting(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'interview-invites-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setSingleResult(null);
    setBulkResult(null);
    setFile(null);
    setError(undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send interview invite"
        className="w-full max-w-lg bg-surface-container-lowest rounded-3xl shadow-xl border border-surface-variant/50 p-8 space-y-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-headline-sm font-headline-sm text-primary">Send interview</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              Invite a candidate to a published interview kit. They get a private link by email.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name="close" />
          </button>
        </div>

        {singleResult ? (
          <LinkSuccess
            title="Invite created"
            description={
              <>
                Link for <span className="font-bold text-on-surface">{singleResult.candidate.name}</span>{' '}
                ({singleResult.candidate.email}) — an email with this link is on its way too.
              </>
            }
            links={[{ token: singleResult.token, label: singleResult.candidate.email }]}
            onDone={onClose}
            onSendAnother={reset}
          />
        ) : bulkResult ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                <Icon name="mark_email_read" className="text-xl text-success" filled />
              </div>
              <div>
                <p className="font-bold text-on-surface">
                  Bulk import finished — {bulkResult.successes} of {bulkResult.total} invites
                  created{bulkResult.errors > 0 ? `, ${bulkResult.errors} failed` : ''}.
                </p>
                <p className="text-sm text-on-surface-variant mt-1">
                  Invite emails were sent to every successfully created row.
                </p>
              </div>
            </div>

            {bulkResult.errors > 0 && (
              <div className="rounded-2xl border border-error/30 bg-error/5 p-4 space-y-1.5">
                <p className="text-sm font-bold text-error">Row errors</p>
                {bulkResult.results
                  .filter((r) => r.error)
                  .map((r) => (
                    <p key={r.row} className="text-xs text-on-surface-variant">
                      Row {r.row}: {r.error}
                    </p>
                  ))}
              </div>
            )}

            {bulkSuccessRows.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowBulkLinks((v) => !v)}
                  className="text-sm font-bold text-primary inline-flex items-center gap-1"
                >
                  <Icon name={showBulkLinks ? 'expand_less' : 'expand_more'} />
                  {showBulkLinks ? 'Hide' : 'Show'} {bulkSuccessRows.length} created link
                  {bulkSuccessRows.length === 1 ? '' : 's'}
                </button>
                {showBulkLinks && (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {bulkSuccessRows.map((r) => (
                      <CopyLinkRow
                        key={r.row}
                        token={r.token as string}
                        label={`Row ${r.row} — ${r.candidate?.email ?? ''}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Send more
              </Button>
              <Button className="flex-1" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex rounded-2xl bg-surface-container p-1" role="tablist">
              {(
                [
                  ['single', 'Single candidate'],
                  ['bulk', 'Bulk CSV'],
                ] as Array<[Tab, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => {
                    setTab(value);
                    setError(undefined);
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                    tab === value
                      ? 'bg-surface-container-lowest text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {kitsError && (
              <p className="text-sm text-error bg-error/5 rounded-xl px-4 py-3">{kitsError}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="invite-kit" className="text-sm font-bold leading-none text-primary">
                  Kit
                </label>
                <select
                  id="invite-kit"
                  value={kitId}
                  onChange={(event) => {
                    setKitId(event.target.value);
                    if (error) setError(undefined);
                  }}
                  className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-base text-on-surface"
                >
                  <option value="">Select a kit…</option>
                  {selectableKits.map((kit) => (
                    <option key={kit.id} value={kit.id}>
                      {kit.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="invite-version"
                  className="text-sm font-bold leading-none text-primary"
                >
                  Version
                </label>
                <select
                  id="invite-version"
                  value={kitVersionId}
                  onChange={(event) => setKitVersionId(event.target.value)}
                  disabled={!kitId || versions.length === 0}
                  className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-base text-on-surface disabled:opacity-50"
                >
                  {versions.length === 0 ? (
                    <option value="">{kitId ? 'No published versions' : 'Pick a kit first'}</option>
                  ) : (
                    versions
                      .slice()
                      .sort((a, b) => b.version - a.version)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version}
                          {v.id === latestVersion?.id ? ' (latest)' : ''}
                        </option>
                      ))
                  )}
                </select>
              </div>
            </div>

            {tab === 'single' ? (
              <form className="space-y-4" onSubmit={(event) => void handleSingleSubmit(event)} noValidate>
                <Input
                  id="candidate-name"
                  label="Full name"
                  icon="person"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  id="candidate-email"
                  label="Email address"
                  icon="mail"
                  type="email"
                  placeholder="ada@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    id="candidate-phone"
                    label="Phone (optional)"
                    icon="call"
                    placeholder="+91 …"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                  <Input
                    id="candidate-ref"
                    label="External ref (optional)"
                    icon="tag"
                    placeholder="ATS id"
                    value={externalRef}
                    onChange={(event) => setExternalRef(event.target.value)}
                  />
                </div>
                <Input
                  id="candidate-expiry"
                  label="Link expires in (days)"
                  icon="schedule"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                />
                {error && <p className="text-sm text-error">{error}</p>}
                <Button type="submit" size="lg" className="w-full" icon="send" loading={submitting}>
                  Send &amp; show link
                </Button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={(event) => void handleBulkSubmit(event)} noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="bulk-file" className="text-sm font-bold leading-none text-primary">
                    CSV file
                  </label>
                  <input
                    id="bulk-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl text-base text-on-surface file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-surface-container file:text-primary file:text-sm file:font-bold"
                  />
                  <p className="text-xs text-on-surface-variant">
                    Columns: name, email, phone (optional), external_ref (optional). Max 10,000 rows.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="text-sm font-bold text-primary inline-flex items-center gap-1"
                >
                  <Icon name="download" />
                  Download template
                </button>
                {error && <p className="text-sm text-error">{error}</p>}
                <Button type="submit" size="lg" className="w-full" icon="upload" loading={submitting}>
                  Upload &amp; invite
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Copy-once link display shared by single and bulk success states (D4). */
function LinkSuccess({
  title,
  description,
  links,
  onDone,
  onSendAnother,
}: {
  title: string;
  description: React.ReactNode;
  links: Array<{ token: string; label: string }>;
  onDone: () => void;
  onSendAnother: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
          <Icon name="check_circle" className="text-xl text-success" filled />
        </div>
        <div>
          <p className="font-bold text-on-surface">{title}</p>
          <p className="text-sm text-on-surface-variant mt-0.5">{description}</p>
        </div>
      </div>
      <div className="space-y-2">
        {links.map((link) => (
          <CopyLinkRow key={link.token} token={link.token} label={link.label} />
        ))}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onSendAnother}>
          Send another
        </Button>
        <Button className="flex-1" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function CopyLinkRow({ token, label }: { token: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const link = candidateLink(token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the input is selectable for manual copy.
    }
  }

  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs font-bold text-on-surface-variant">{label}</p>}
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(event) => event.target.select()}
          aria-label="Candidate link"
          className="flex-1 min-w-0 px-4 py-2.5 bg-surface-container border border-outline-variant rounded-xl text-sm text-on-surface outline-none"
        />
        <Button
          variant={copied ? 'secondary' : 'outline'}
          icon={copied ? 'check' : 'content_copy'}
          onClick={() => void copy()}
          className="shrink-0"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs text-on-surface-variant">This link is shown once — copy it now.</p>
    </div>
  );
}
