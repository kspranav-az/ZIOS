import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyView,
  type CreatedApiKeyView,
} from '../../lib/keys-api';

/**
 * API Keys — Integration API management (FR-E13-1). Admin-only mutations;
 * interviewers can view the list. Keys are shown in full exactly once at
 * creation/rotation; afterwards only the prefix is displayed.
 */

const COLUMNS = ['Key', 'Label', 'Scopes', 'Rate limit', 'Created', 'Status', ''];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function KeyRevealModal({ created, onClose }: { created: CreatedApiKeyView; onClose: () => void }) {
  const { push: toast } = useToast();

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(created.key);
      toast('Key copied to clipboard', 'success');
    } catch {
      toast('Copy failed — select the key manually', 'error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card padding="lg" className="w-full max-w-lg">
        <h3 className="font-headline-md text-headline-md text-primary">API key created</h3>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2">
          This is the only time the full key is shown. Store it somewhere safe — you will only see
          the prefix <span className="font-label-bold">{created.prefix}…</span> from now on.
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-3">
          <code className="flex-1 break-all text-sm text-on-surface">{created.key}</code>
          <button
            type="button"
            onClick={() => void copyKey()}
            className="shrink-0 text-primary hover:text-primary/80"
            aria-label="Copy key"
          >
            <Icon name="content_copy" className="text-xl" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onClose}>Done</Button>
        </div>
      </Card>
    </div>
  );
}

export function ApiKeysPage() {
  const { state } = useAuth();
  const { push: toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<'test' | 'live'>('test');
  const [newLabel, setNewLabel] = useState('');
  const [reveal, setReveal] = useState<CreatedApiKeyView | null>(null);
  const [confirmKey, setConfirmKey] = useState<{ action: 'rotate' | 'revoke'; key: ApiKeyView } | null>(
    null,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const isAdmin = state.status === 'authenticated' && state.user.role === 'admin';

  const reload = useCallback(async () => {
    try {
      const result = await listApiKeys();
      setKeys(result.keys);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate() {
    setCreating(true);
    try {
      const label = newLabel.trim();
      const created = await createApiKey({ kind: newKind, ...(label ? { label } : {}) });
      setReveal(created);
      setNewLabel('');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create key', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleRotate(key: ApiKeyView) {
    setActionBusy(true);
    try {
      const rotated = await rotateApiKey(key.id);
      setReveal(rotated);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to rotate key', 'error');
    } finally {
      setActionBusy(false);
      setConfirmKey(null);
    }
  }

  async function handleRevoke(key: ApiKeyView) {
    setActionBusy(true);
    try {
      await revokeApiKey(key.id);
      toast(`Key ${key.prefix}… revoked`, 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to revoke key', 'error');
    } finally {
      setActionBusy(false);
      setConfirmKey(null);
    }
  }

  function runConfirmKeyAction() {
    if (!confirmKey) return;
    if (confirmKey.action === 'rotate') {
      void handleRotate(confirmKey.key);
    } else {
      void handleRevoke(confirmKey.key);
    }
  }

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            API Keys
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
            Let partner systems create interviews and read results over the Integration API.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="Label (e.g. Greenhouse ATS)"
              aria-label="Key label"
              className="min-w-56 rounded-full border-none bg-surface-container-low px-4 py-2.5 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/10"
            />
            <select
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as 'test' | 'live')}
              className="bg-surface-container-low border-none rounded-full px-4 py-2.5 text-on-surface font-body-md text-sm outline-none focus:ring-2 focus:ring-primary/10"
              aria-label="Key kind"
            >
              <option value="test">Test key</option>
              <option value="live">Live key</option>
            </select>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Creating…' : 'Create key'}
            </Button>
          </div>
        )}
      </section>

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
              {error !== null && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-6 py-16 text-center">
                    <p className="font-label-bold text-label-bold text-error">{error}</p>
                  </td>
                </tr>
              )}
              {error === null && keys === null && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-6 py-16 text-center">
                    <p className="text-sm text-on-surface-variant">Loading…</p>
                  </td>
                </tr>
              )}
              {error === null && keys !== null && keys.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-6 py-16">
                    <div className="flex flex-col items-center text-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center">
                        <Icon name="key" className="text-2xl text-outline" />
                      </div>
                      <div>
                        <p className="font-label-bold text-label-bold text-primary">No API keys</p>
                        <p className="text-sm text-on-surface-variant mt-1">
                          {isAdmin
                            ? 'Create a test key to start integrating your ATS or HR system.'
                            : 'Ask an admin to create an API key.'}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {keys?.map((key) => (
                <tr
                  key={key.id}
                  className="border-b border-surface-variant/30 last:border-none hover:bg-surface-container-low/50"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Badge tone={key.kind === 'live' ? 'warning' : 'primary'}>
                        {key.kind === 'live' ? 'LIVE' : 'TEST'}
                      </Badge>
                      <code className="text-sm text-on-surface">{key.prefix}…</code>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">{key.label ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {key.scopes.join(', ')}
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {key.rateLimitPerMin}/min
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {formatDate(key.createdAt)}
                    {key.rotatedAt && (
                      <span className="block text-xs">rotated {formatDate(key.rotatedAt)}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {key.revokedAt ? (
                      <Badge tone="error" icon="block">
                        Revoked
                      </Badge>
                    ) : (
                      <Badge tone="success" icon="check_circle">
                        Active
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {isAdmin && !key.revokedAt && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmKey({ action: 'rotate', key })}
                          className="text-primary hover:text-primary/80 text-sm font-label-bold"
                        >
                          Rotate
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmKey({ action: 'revoke', key })}
                          className="text-error hover:text-error/80 text-sm font-label-bold"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {reveal && <KeyRevealModal created={reveal} onClose={() => setReveal(null)} />}

      <ConfirmDialog
        open={confirmKey !== null}
        title={confirmKey?.action === 'rotate' ? 'Rotate this API key?' : 'Revoke this API key?'}
        description={
          confirmKey?.action === 'rotate'
            ? `A new key replaces ${confirmKey.key.prefix}… immediately. The full new key is shown once — update your integration right away.`
            : `Key ${confirmKey?.key.prefix ?? ''}… stops working immediately. Integrations using it will fail.`
        }
        confirmLabel={confirmKey?.action === 'rotate' ? 'Rotate key' : 'Revoke key'}
        tone={confirmKey?.action === 'revoke' ? 'danger' : 'primary'}
        busy={actionBusy}
        onConfirm={runConfirmKeyAction}
        onCancel={() => setConfirmKey(null)}
      />
    </div>
  );
}
