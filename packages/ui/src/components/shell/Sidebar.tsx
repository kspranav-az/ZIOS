import { NavLink } from 'react-router-dom';
import { BrandLogo } from '../BrandLogo';
import { Icon } from '../Icon';

export interface NavItem {
  id: string;
  label: string;
  /** Material Symbols icon name. */
  icon: string;
  /** Route path — matched with `startsWith` like the reference. */
  to: string;
  /** Marks the item active only on an exact path match (for the index route). */
  end?: boolean;
}

export interface SidebarProps {
  navItems: NavItem[];
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onLogout: () => void;
}

/**
 * Left navigation rail. Ported from the design reference's
 * RecruiterLayout.jsx SideNavBar: w-64 surface-container, BrandLogo header,
 * active item = primary text + secondary left border + container-high bg.
 */
export function Sidebar({ navItems, mobileOpen, onMobileOpenChange, onLogout }: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => onMobileOpenChange(false)}
        />
      )}
      <aside
        className={`h-screen w-64 fixed left-0 top-0 bg-surface-container flex flex-col py-6 z-50 transition-transform duration-300 overflow-hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="px-6 mb-10 flex items-center justify-between">
          <BrandLogo size={168} />
          <button
            type="button"
            aria-label="Close navigation"
            className="lg:hidden text-on-surface-variant"
            onClick={() => onMobileOpenChange(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        <nav
          aria-label="Primary"
          className="flex-1 px-4 space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.end}
              onClick={() => onMobileOpenChange(false)}
              className={({ isActive }) =>
                `w-full flex items-center gap-4 px-4 py-3 rounded-xl font-body-md text-body-md transition-colors group ${
                  isActive
                    ? 'text-primary font-bold border-l-4 border-secondary bg-surface-container-high'
                    : 'text-on-surface-variant opacity-70 hover:bg-surface-container-high'
                }`
              }
            >
              <Icon
                name={item.icon}
                className="group-active:scale-95 transition-transform duration-150"
              />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 mt-2 pt-4 border-t border-outline-variant/40">
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-xl font-body-md text-body-md text-error opacity-80 hover:opacity-100 hover:bg-error/10 transition-colors group"
          >
            <Icon
              name="logout"
              className="group-active:scale-95 transition-transform duration-150"
            />
            <span>Log Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
