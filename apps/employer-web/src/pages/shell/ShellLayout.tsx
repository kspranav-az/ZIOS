import { Outlet, useNavigate } from 'react-router-dom';
import { AppShell, type NavItem } from '@zios/ui';
import { useAuth } from '../../auth/AuthContext';

/** Reference RecruiterLayout nav (same labels, same Material Symbols icons). */
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: '/', end: true },
  { id: 'candidates', label: 'Candidates', icon: 'group', to: '/candidates' },
  { id: 'interviews', label: 'Interviews', icon: 'video_chat', to: '/interviews' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics', to: '/analytics' },
];

const ROLE_LABELS = {
  admin: 'Admin',
  interviewer: 'Interviewer',
} as const;

export function ShellLayout() {
  const { state, logout } = useAuth();
  const navigate = useNavigate();

  if (state.status !== 'authenticated') return null;

  const { user, org } = state;

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <AppShell
      navItems={NAV_ITEMS}
      user={{ name: user.name, email: user.email, roleLabel: ROLE_LABELS[user.role] }}
      orgName={org.name}
      onLogout={() => void handleLogout()}
    >
      <Outlet />
    </AppShell>
  );
}
