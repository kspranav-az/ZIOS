import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AppUser, AuthResponse, Org, OtpRequestResponse } from '@zios/shared-types';
import { ApiRequestError, setUnauthorizedHandler } from '../lib/api';
import { authApi } from '../lib/auth-api';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: AppUser; org: Org };

export interface AuthContextValue {
  state: AuthState;
  /** Step 1 of sign-in: email a 6-digit code. Throws ApiRequestError. */
  requestOtp: (email: string) => Promise<OtpRequestResponse>;
  /** Step 2: verify the code; on success the session cookie is set by the api. */
  verifyOtp: (email: string, code: string) => Promise<AuthResponse>;
  /** Re-reads /auth/me into state (e.g. after accepting an invite). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    // Any 401 anywhere (expired/revoked session) drops the app to signed-out.
    setUnauthorizedHandler(() => setState({ status: 'unauthenticated' }));
    return () => setUnauthorizedHandler(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user, org } = await authApi.me();
      setState({ status: 'authenticated', user, org });
    } catch (error) {
      if (error instanceof ApiRequestError && error.statusCode !== 401) {
        // Network/server failure: keep the user signed out but do not spin forever.
        setState({ status: 'unauthenticated' });
        return;
      }
      setState({ status: 'unauthenticated' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestOtp = useCallback((email: string) => authApi.requestOtp(email), []);

  const verifyOtp = useCallback(async (email: string, code: string) => {
    const response = await authApi.verifyOtp(email, code);
    setState({ status: 'authenticated', user: response.user, org: response.org });
    return response;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the revoke call fails (offline), the local state must not
      // keep the user signed in.
    } finally {
      setState({ status: 'unauthenticated' });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, requestOtp, verifyOtp, refresh, logout }),
    [state, requestOtp, verifyOtp, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
