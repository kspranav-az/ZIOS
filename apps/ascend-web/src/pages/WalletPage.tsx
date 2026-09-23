import { useEffect, useState } from 'react';
import { Button, Card } from '@zios/ui';
import { ApiErrorResponse, fetchWallet, type CandidateWalletResponse } from '../api';
import { PageShell } from '../components/PageShell';

const REASON_LABELS: Record<string, string> = {
  welcome_grant: 'Welcome grant',
  practice_start: 'Practice mock',
  admin_grant: 'Beta top-up',
  refund: 'Refund',
};

function formatReason(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WalletPage() {
  const [wallet, setWallet] = useState<CandidateWalletResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWallet()
      .then(setWallet)
      .catch((err: unknown) => {
        if (err instanceof ApiErrorResponse && err.statusCode === 401) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load your wallet.');
      });
  }, []);

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col py-8">
        <h1 className="text-headline-sm text-on-surface">Wallet</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Practice credits and how they were spent.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            {error}
          </p>
        )}

        {wallet && (
          <>
            <Card padding="lg" radius="2xl" className="mt-6">
              <p className="text-body-md text-on-surface-variant">Balance</p>
              <p className="mt-1 text-headline-md text-on-surface">{wallet.balance}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Low-balance alert line: {wallet.lowBalanceThreshold} credits
              </p>
            </Card>

            {wallet.balance === 0 && (
              <Card padding="lg" radius="2xl" className="mt-4 bg-surface-container-low">
                <p className="text-title-md text-on-surface">You are out of credits</p>
                <p className="mt-2 text-body-md text-on-surface-variant">
                  During the closed beta, credits are topped up by the Ascend team.
                  Reach out and we will grant you more.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    window.location.href =
                      'mailto:ascend-beta@zios.example?subject=Ascend%20beta%20credit%20top-up';
                  }}
                >
                  Request a top-up
                </Button>
              </Card>
            )}

            <h2 className="mt-8 text-title-md text-on-surface">Ledger</h2>
            {wallet.ledger.length === 0 ? (
              <p className="mt-3 text-body-md text-on-surface-variant">No activity yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-outline-variant rounded-xl bg-surface-container-low">
                {wallet.ledger.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <p className="text-body-md text-on-surface">
                        {formatReason(entry.reason)}
                      </p>
                      <p className="text-body-sm text-on-surface-variant">
                        {formatDate(entry.createdAt)} · balance {entry.balanceAfter}
                      </p>
                    </div>
                    <p
                      className={
                        entry.delta > 0
                          ? 'text-body-md font-medium text-primary'
                          : 'text-body-md font-medium text-on-surface'
                      }
                    >
                      {formatDelta(entry.delta)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
