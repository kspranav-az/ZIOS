import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar, type NavItem } from './Sidebar';
import { Topbar, type TopbarUser } from './Topbar';

export interface AppShellProps {
  navItems: NavItem[];
  user: TopbarUser;
  /** Organization name shown in the topbar; omit for org-less apps. */
  orgName?: string;
  onLogout: () => void;
  children: ReactNode;
  /** Optional topbar trailing slot (e.g. the Ascend wallet chip). */
  actions?: ReactNode;
}

/**
 * Authenticated app frame. Ported from the design reference's
 * RecruiterLayout.jsx — fixed sidebar (16rem), blurred topbar, content area
 * with the per-route 220ms fade/slide-in transition.
 */
export function AppShell({ navItems, user, orgName, onLogout, children, actions }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [contentVisible, setContentVisible] = useState(false);
  const location = useLocation();

  useLayoutEffect(() => {
    setContentVisible(false);
    const frame = window.requestAnimationFrame(() => setContentVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  return (
    <div className="bg-background text-on-surface min-h-screen overflow-x-hidden font-sans">
      <Sidebar
        navItems={navItems}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        onLogout={onLogout}
      />
      <Topbar
        user={user}
        orgName={orgName}
        search={search}
        onSearchChange={setSearch}
        onMenuOpen={() => setMobileOpen(true)}
        onLogout={onLogout}
        actions={actions}
      />

      <main className="lg:ml-64 pt-24 px-4 sm:px-8 pb-12 overflow-x-hidden">
        <div
          key={location.pathname}
          className="will-change-transform"
          style={{
            opacity: contentVisible ? 1 : 0,
            transform: contentVisible ? 'translateX(0)' : 'translateX(16px)',
            transition: 'opacity 220ms ease, transform 220ms ease',
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
