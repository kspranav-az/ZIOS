import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewProvider, recoveryTokenKey, SESSION_ID_KEY } from '../InterviewContext';
import { TokenLandingPage } from './TokenLandingPage';

function createRouter(initialEntries: string[]) {
  return createMemoryRouter(
    [
      { path: '/', element: <TokenLandingPage /> },
      { path: '/otp', element: <div data-testid="otp-page" /> },
      { path: '/consent', element: <div data-testid="consent-page" /> },
      { path: '/interview', element: <div data-testid="interview-page" /> },
      { path: '/complete', element: <div data-testid="complete-page" /> },
      { path: '/expired', element: <div data-testid="expired-page" /> },
    ],
    { initialEntries },
  );
}

function renderWithProvider(initialEntries: string[]) {
  const router = createRouter(initialEntries);
  render(
    <InterviewProvider>
      <RouterProvider router={router} />
    </InterviewProvider>,
  );
  return router;
}

const baseInvite = {
  id: 'invite-1',
  orgId: 'org-1',
  kitVersionId: 'kv-1',
  candidateId: 'candidate-1',
  tokenHash: 'hash',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  otpRequired: false,
  otpVerifiedAt: null,
  status: 'invited',
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseCandidate = {
  id: 'candidate-1',
  orgId: 'org-1',
  name: 'Alice',
  email: 'alice@example.com',
  phone: null,
  externalRef: null,
  piiVaultRef: null,
  createdAt: new Date().toISOString(),
};

describe('TokenLandingPage routing decisions', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('navigates to /consent for a fresh invite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          invite: baseInvite,
          candidate: baseCandidate,
          kit: { id: 'kit-1', title: 'Engineer' },
          questions: [],
          otpRequired: false,
          otpVerified: false,
          session: null,
          consent: null,
        }),
      }),
    );

    const router = renderWithProvider(['/?token=fresh-token']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/consent'));
  });

  it('navigates to /complete for an already completed invite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          invite: { ...baseInvite, status: 'completed' },
          candidate: baseCandidate,
          kit: { id: 'kit-1', title: 'Engineer' },
          questions: [],
          otpRequired: false,
          otpVerified: false,
          session: null,
          consent: null,
        }),
      }),
    );

    const router = renderWithProvider(['/?token=completed-token']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/complete'));
  });

  it('navigates to /expired for an expired invite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          invite: {
            ...baseInvite,
            status: 'expired',
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
          },
          candidate: baseCandidate,
          kit: { id: 'kit-1', title: 'Engineer' },
          questions: [],
          otpRequired: false,
          otpVerified: false,
          session: null,
          consent: null,
        }),
      }),
    );

    const router = renderWithProvider(['/?token=expired-token']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/expired'));
  });

  it('navigates to /otp when OTP is required and not verified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          invite: baseInvite,
          candidate: baseCandidate,
          kit: { id: 'kit-1', title: 'Engineer' },
          questions: [],
          otpRequired: true,
          otpVerified: false,
          session: null,
          consent: null,
        }),
      }),
    );

    const router = renderWithProvider(['/?token=otp-token']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/otp'));
  });

  it('navigates to /interview when a live session exists', async () => {
    // Rejoining requires the recovery token issued at consent (see 7c2b651):
    // seed sessionStorage as if this device completed consent for session-1.
    sessionStorage.setItem(SESSION_ID_KEY, 'session-1');
    sessionStorage.setItem(recoveryTokenKey('session-1'), 'recovery-token-1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          invite: { ...baseInvite, status: 'started' },
          candidate: baseCandidate,
          kit: { id: 'kit-1', title: 'Engineer' },
          questions: [],
          otpRequired: false,
          otpVerified: false,
          session: {
            id: 'session-1',
            inviteId: 'invite-1',
            kitVersionId: 'kv-1',
            mode: 'text',
            conductor: 'ai',
            status: 'live',
            consentId: 'consent-1',
            preflightReport: {},
            startedAt: new Date().toISOString(),
            endedAt: null,
            mediaRefs: [],
            integrityEvents: [],
            schemaVersion: 1,
            recoveryTokenHash: 'hash',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          consent: null,
        }),
      }),
    );

    const router = renderWithProvider(['/?token=live-token']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/interview'));
  });

  it('shows an error when no token is provided', async () => {
    renderWithProvider(['/']);
    expect(await screen.findByText(/No invite link found/)).toBeInTheDocument();
  });

  it('shows an error when the token is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          statusCode: 404,
          code: 'INVITE_NOT_FOUND',
          message: 'Invite not found',
        }),
      }),
    );

    renderWithProvider(['/?token=invalid-token']);
    expect(await screen.findByText(/Invite link issue/)).toBeInTheDocument();
    expect(await screen.findByText(/Invite not found/)).toBeInTheDocument();
  });
});
