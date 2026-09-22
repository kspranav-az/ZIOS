import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Icon } from '@zios/ui';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import {
  fetchWallet,
  setLowBalanceThreshold,
  type LedgerEntryView,
  type PricingKind,
  type WalletView,
} from '../../lib/credits-api';

/**
 * Credits wallet (FR-E14): balance card, per-mode pricing, append-only
 * ledger, and the low-balance alert threshold. Mutations are admin-only;
 * the ledger is the source of truth (balance column is a cached total).
 */

const PRICING_LABELS: Record<PricingKind, string> = {
  text: 'Text interview',
  voice: 'Voice interview',
  video: 'Video interview',
  human: 'Human-facilitated',
  async_video: 'Async video',
};

const LEDGER_COLUMNS = ['Change', 'Reason', 'Balance after', 'When'];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WalletPage() {
  const { state } = useAuth();
  const { push: toast } = useToast();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const isAdmin = state.status === 'authenticated' && state.user.role === 'admin';

  const reload = useCallback(async () => {
    try {
      const result = await fetchWallet();
      setWallet(result);
      setThresholdDraft(String(result.lowBalanceThreshold));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleSaveThreshold() {
    const threshold = Number(thresholdDraft);
    if (!Number.isInteger(threshold) || threshold < 0) {
      toast('Threshold must be a non-negative integer', 'error');
      return;
    }
    setSavingThreshold(true);
    try {
      await setLowBalanceThreshold(threshold);
      toast('Low-balance threshold updated', 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update threshold', 'error');
    } finally {
      setSavingThreshold(false);
    }
  }

  const low = wallet !== null && wallet.balance <= wallet.lowBalanceThreshold;

  return (
    <div className="max-w-container-max mx-auto">
      <section className="mb-8">
        <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
          Wallet
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
          Interview credits: balance, per-mode pricing, and the full ledger.
        </p>
      </section>

      {error !== null && (
        <Card padding="lg" className="mb-8">
          <p className="font-label-bold text-label-bold text-error">{error}</p>
        </Card>
      )}

      {error === null && wallet === null && (
        <Card padding="lg" className="mb-8">
          <p className="text-sm text-on-surface-variant">Loading…</p>
        </Card>
      )}

      {wallet !== null && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <Card padding="lg">
              <div className="flex items-center gap-3 mb-2">
                <Icon name="account_balance_wallet" className="text-2xl text-primary" />
                <h3 className="font-headline-md text-headline-md text-primary">Balance</h3>
              </div>
              <p className="font-display-lg text-display-lg text-primary">{wallet.balance}</p>
              <div className="mt-3">
                {low ? (
                  <Badge tone="error" icon="warning">
                    Low balance
                  </Badge>
                ) : (
                  <Badge tone="success" icon="check_circle">
                    Healthy
                  </Badge>
                )}
              </div>
            </Card>

            <Card padding="lg">
              <div className="flex items-center gap-3 mb-2">
                <Icon name="notifications" className="text-2xl text-primary" />
                <h3 className="font-headline-md text-headline-md text-primary">Alert threshold</h3>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant mb-4">
                Admins are emailed (at most once per 24h) when the balance drops below this.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  value={thresholdDraft}
                  onChange={(event) => setThresholdDraft(event.target.value)}
                  disabled={!isAdmin}
                  className="w-28 bg-surface-container-low border-none rounded-full px-4 py-2.5 text-on-surface font-body-md text-sm outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60"
                  aria-label="Low-balance threshold"
                />
                {isAdmin && (
                  <Button onClick={() => void handleSaveThreshold()} disabled={savingThreshold}>
                    {savingThreshold ? 'Saving…' : 'Save'}
                  </Button>
                )}
              </div>
            </Card>

            <Card padding="lg">
              <div className="flex items-center gap-3 mb-3">
                <Icon name="sell" className="text-2xl text-primary" />
                <h3 className="font-headline-md text-headline-md text-primary">Pricing</h3>
              </div>
              <dl>
                {(Object.keys(wallet.pricing) as PricingKind[]).map((kind) => (
                  <div key={kind} className="flex justify-between py-1">
                    <dt className="text-sm text-on-surface-variant">{PRICING_LABELS[kind]}</dt>
                    <dd className="text-sm font-label-bold text-on-surface">
                      {wallet.pricing[kind]} cr
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <h3 className="font-headline-md text-headline-md text-primary mb-4">Ledger</h3>
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-surface-variant/50">
                    {LEDGER_COLUMNS.map((column) => (
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
                  {wallet.ledger.length === 0 && (
                    <tr>
                      <td colSpan={LEDGER_COLUMNS.length} className="px-6 py-16 text-center">
                        <p className="text-sm text-on-surface-variant">No ledger entries yet.</p>
                      </td>
                    </tr>
                  )}
                  {wallet.ledger.map((entry: LedgerEntryView) => (
                    <tr
                      key={entry.id}
                      className="border-b border-surface-variant/30 last:border-none hover:bg-surface-container-low/50"
                    >
                      <td className="px-6 py-4">
                        <span
                          className={
                            entry.delta > 0
                              ? 'text-sm font-label-bold text-green-700'
                              : 'text-sm font-label-bold text-on-surface'
                          }
                        >
                          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-xs text-on-surface">{entry.reason}</code>
                        {entry.sessionRef && (
                          <span className="block text-xs text-on-surface-variant mt-1">
                            session {entry.sessionRef.slice(0, 8)}…
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {entry.balanceAfter}
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {formatDateTime(entry.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
