import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AppUser, AuthResponse, Org } from '@zios/shared-types';
import { ApiRequestError } from '../lib/api';
import { authApi } from '../lib/auth-api';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { RequireAuth } from '../auth/guards';
import { LoginPage } from '../pages/auth/LoginPage';

vi.mock('../lib/auth-api', () => ({
  authApi: {
    me: vi.fn(),
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
    logout: vi.fn(),
    acceptInvite: vi.fn(),
    createInvite: vi.fn(),
  },
}));

const mocked = vi.mocked(authApi);

const user: AppUser = {
  id: 'u1',
  orgId: 'o1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const org: Org = {
  id: 'o1',
  name: 'Example',
  plan: 'pilot',
  creditsBalance: 0,
  lowBalanceThreshold: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const authResponse: AuthResponse = {
  session: { token: 'opaque', expiresAt: '2026-02-01T00:00:00.000Z' },
  isNewUser: false,
  user,
  org,
};

/** Probe exposing the auth state and actions to assertions. */
function AuthProbe() {
  const { state, verifyOtp, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      {state.status === 'authenticated' && (
        <span data-testid="who">{`${state.user.email} @ ${state.org.name}`}</span>
      )}
      <button type="button" onClick={() => void verifyOtp('a@b.com', '123456')}>
        verify
      </button>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{`${location.pathname}${location.search}`}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('resolves to authenticated when /auth/me succeeds', async () => {
    mocked.me.mockResolvedValue({ user, org });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('who')).toHaveTextContent('admin@example.com @ Example');
  });

  it('resolves to unauthenticated when /auth/me returns 401', async () => {
    mocked.me.mockRejectedValue(new ApiRequestError(401, 'UNAUTHENTICATED', 'no session'));
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('does not spin forever on network failure during boot', async () => {
    mocked.me.mockRejectedValue(new ApiRequestError(0, 'NETWORK_ERROR', 'down'));
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('verifyOtp stores the returned user/org (cookie is the session, token untouched)', async () => {
    mocked.me.mockRejectedValue(new ApiRequestError(401, 'UNAUTHENTICATED', 'no session'));
    mocked.verifyOtp.mockResolvedValue(authResponse);
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    await userEvent.click(screen.getByRole('button', { name: 'verify' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('who')).toHaveTextContent('admin@example.com @ Example');
  });

  it('logout revokes server-side and clears state', async () => {
    mocked.me.mockResolvedValue({ user, org });
    mocked.logout.mockResolvedValue(undefined);
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await userEvent.click(screen.getByRole('button', { name: 'logout' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(mocked.logout).toHaveBeenCalledTimes(1);
  });
});

describe('route guards', () => {
  function renderGuarded(initialPath: string) {
    return render(
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <LocationProbe />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <span>shell</span>
                </RequireAuth>
              }
            />
            <Route
              path="/accept-invite"
              element={
                <RequireAuth>
                  <span>accept invite</span>
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
  }

  it('redirects unauthenticated users from / to /login', async () => {
    mocked.me.mockRejectedValue(new ApiRequestError(401, 'UNAUTHENTICATED', 'no session'));
    renderGuarded('/');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByText('shell')).not.toBeInTheDocument();
  });

  it('bounces authenticated users away from /login to /', async () => {
    mocked.me.mockResolvedValue({ user, org });
    renderGuarded('/login');
    await screen.findByText('shell');
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument();
  });

  it('keeps the attempted location for post-login return (invite flow)', async () => {
    mocked.me.mockRejectedValue(new ApiRequestError(401, 'UNAUTHENTICATED', 'no session'));
    renderGuarded('/accept-invite?token=abc');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.getByTestId('path')).toHaveTextContent('/login');
  });

  it('renders protected content for authenticated users', async () => {
    mocked.me.mockResolvedValue({ user, org });
    renderGuarded('/accept-invite?token=abc');
    await screen.findByText('accept invite');
  });
});
