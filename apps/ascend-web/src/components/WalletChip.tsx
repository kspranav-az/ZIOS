import { useEffect, useState } from 'react';
import { Icon } from '@zios/ui';
import { ApiErrorResponse, fetchWallet } from '../api';

/** Wallet chip for the Ascend shell header (M2): live credit balance. */
export function WalletChip() {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => fetchWallet())
      .then((wallet) => {
        if (!cancelled) setBalance(wallet.balance);
      })
      .catch((err: unknown) => {
        // A stale/expired token redirects via the page-level handlers; the
        // chip just stays hidden rather than flashing an error.
        if (!cancelled && !(err instanceof ApiErrorResponse && err.statusCode === 401)) {
          setBalance(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (balance === null) return null;

  return (
    <a
      href="/practice"
      className="flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 text-label-bold text-on-surface-variant transition-colors hover:bg-surface-container-high"
      aria-label={`${balance} practice credits remaining`}
      title="Practice credits"
    >
      <Icon name="stars" className="text-base" />
      <span data-testid="wallet-balance">{balance}</span>
      <span className="hidden sm:inline">credits</span>
    </a>
  );
}
