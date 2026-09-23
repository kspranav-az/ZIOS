import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

export interface TopbarUser {
  name: string;
  email: string;
  /** Display label for the user's role, e.g. "Admin". */
  roleLabel: string;
}

export interface TopbarProps {
  user: TopbarUser;
  /** Current organization name, shown in the user block and menu. Omit for
   *  org-less apps (e.g. the candidate-facing Ascend shell). */
  orgName?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onMenuOpen: () => void;
  onLogout: () => void;
  /** Optional trailing slot rendered before the notifications icon —
   *  Ascend uses it for the practice-credits wallet chip. */
  actions?: ReactNode;
}

/**
 * Sticky top bar. Ported from the design reference's RecruiterLayout.jsx
 * TopNavBar — search field, notifications/help, divider, user block — with
 * the hardcoded identity replaced by the signed-in user + org, and the
 * avatar gaining a real menu (profile details + sign out).
 */
export function Topbar({
  user,
  orgName,
  search,
  onSearchChange,
  onMenuOpen,
  onLogout,
  actions,
}: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [menuOpen]);

  return (
    <header className="fixed top-0 right-0 w-full lg:w-[calc(100%-16rem)] z-30 bg-surface/80 backdrop-blur-md flex justify-between items-center px-4 sm:px-8 h-16">
      <button
        type="button"
        aria-label="Open navigation"
        className="lg:hidden mr-4 text-primary"
        onClick={onMenuOpen}
      >
        <Icon name="menu" />
      </button>

      <div className="flex items-center flex-1 max-w-xl">
        <div className="relative w-full">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg"
          />
          <input
            className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2 text-on-surface focus:ring-2 focus:ring-primary/10 transition-all font-body-md text-sm outline-none"
            placeholder="Search candidates, jobs, or reports..."
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {actions}
        <button
          type="button"
          aria-label="Notifications"
          className="p-2 text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all flex items-center justify-center relative"
        >
          <Icon name="notifications" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-secondary rounded-full" />
        </button>
        <button
          type="button"
          aria-label="Help"
          className="hidden sm:flex p-2 text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all items-center justify-center"
        >
          <Icon name="help" />
        </button>
        <div className="h-8 w-px bg-outline-variant mx-1 sm:mx-2 hidden sm:block" />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-3 rounded-xl px-2 py-1 hover:bg-surface-container-high transition-colors"
          >
            <span className="text-right hidden md:block">
              <span className="block font-label-bold text-label-bold text-primary">
                {user.name}
              </span>
              <span className="block text-[10px] text-on-surface-variant">
                {orgName ? `${user.roleLabel} · ${orgName}` : user.roleLabel}
              </span>
            </span>
            <Avatar
              alt={`${user.name} profile`}
              name={user.name}
              size={40}
              className="border-2 border-primary/20"
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-64 bg-surface-container-lowest rounded-2xl shadow-lg border border-surface-variant/50 py-2 z-50"
            >
              <div className="px-4 py-3 border-b border-surface-variant/40">
                <p className="font-label-bold text-label-bold text-primary">{user.name}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{user.email}</p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {orgName ? `${user.roleLabel} · ${orgName}` : user.roleLabel}
                </p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error/10 transition-colors"
              >
                <Icon name="logout" className="text-lg" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
