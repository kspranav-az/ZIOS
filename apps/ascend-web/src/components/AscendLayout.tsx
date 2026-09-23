import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { AppShell, type NavItem } from '@zios/ui';
import type { CandidateAccount } from '@zios/shared-types';
import { fetchMe, logout } from '../api';
import { clearToken } from '../auth';
import { WalletChip } from './WalletChip';

/** Reference sidebar nav, ported 1:1 from the design system's RecruiterLayout
 *  pattern (same icon + label + active-route treatment) with Ascend's routes.
 *  Home uses `end` so it is active only on the exact index route. */
const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home', to: '/', end: true },
  { id: 'practice', label: 'Practice', icon: 'exercise', to: '/practice' },
  { id: 'progress', label: 'Progress', icon: 'monitoring', to: '/progress' },
  { id: 'resume', label: 'Resume', icon: 'description', to: '/resume' },
  { id: 'wallet', label: 'Wallet', icon: 'account_balance_wallet', to: '/wallet' },
];

/**
 * Authenticated Ascend app frame: sidebar chrome for every page except the
 * immersive flows (login, onboarding, practice consent/interview), which are
 * routed outside this layout in App.tsx. The wallet chip lives in the topbar
 * actions slot so the balance is visible on every chrome page.
 */
export function AscendLayout() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<CandidateAccount | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (!cancelled) setAccount(me.account);
      })
      .catch(() => {
        // Session expiry redirects via RequireAuth on the next navigation;
        // the shell simply renders without a name rather than flashing errors.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      clearToken();
      navigate('/login', { replace: true });
    }
  }

  return (
    <AppShell
      navItems={NAV_ITEMS}
      user={{
        name: account?.name ?? 'Candidate',
        email: account?.email ?? '',
        roleLabel: 'Candidate',
      }}
      onLogout={() => void handleLogout()}
      actions={<WalletChip />}
    >
      <Outlet />
    </AppShell>
  );
}
