import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { BrandLogo } from '@zios/ui';
import { useAuth } from './AuthContext';

/** Full-viewport loading state shown while the session is being resolved. */
export function AuthLoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background text-on-surface">
      <BrandLogo size={160} />
      <div
        role="status"
        aria-label="Loading"
        className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin"
      />
    </div>
  );
}

/**
 * Gate for authenticated routes. Unauthenticated visitors are sent to
 * /login carrying the attempted location so the login page can return them
 * (used by the invite flow: sign in → land back on /accept-invite?token=…).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <AuthLoadingScreen />;
  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
