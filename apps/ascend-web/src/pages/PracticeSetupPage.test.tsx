import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWallet: vi.fn(),
  ApiErrorResponse: class extends Error {
    statusCode: number;
    constructor(error?: { statusCode?: number; message?: string }) {
      super(error?.message);
      this.statusCode = error?.statusCode ?? 500;
    }
  },
  createPractice: vi.fn(),
  createPracticeFromJd: vi.fn(),
  fetchPracticeLibrary: vi.fn(),
  storePracticeRecovery: vi.fn(),
}));

import { ApiErrorResponse, createPractice, fetchPracticeLibrary } from '../api';
import { PracticeSetupPage } from './PracticeSetupPage';

const pack = {
  id: 'hr-screening',
  title: 'HR Screening',
  description: 'Classic first-round questions',
  questions: [
    { id: 'q1', prompt: 'Tell me about yourself', type: 'open_ended', rubricLines: [] },
  ],
} as unknown as import('@zios/shared-types').PracticeLibraryPack;

function renderSetup() {
  const router = createMemoryRouter([{ path: '/practice', element: <PracticeSetupPage /> }], {
    initialEntries: ['/practice'],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('PracticeSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPracticeLibrary).mockResolvedValue({
      packs: [pack],
      consent: { version: 'PRACTICE_CONSENT_TEXT_V1', text: 'Consent text' },
    });
  });

  it('requires a pack selection before starting', async () => {
    const user = userEvent.setup();
    renderSetup();
    expect(await screen.findByText('HR Screening')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue to consent/i })).toBeDisabled();

    await user.click(screen.getByText('HR Screening'));
    expect(screen.getByRole('button', { name: /continue to consent/i })).toBeEnabled();
  });

  it('creates the session, stores the recovery token and routes to consent', async () => {
    const user = userEvent.setup();
    const { storePracticeRecovery } = await import('../api');
    vi.mocked(createPractice).mockResolvedValue({
      session: {
        id: 'ps-1',
        accountId: 'acc-1',
        mode: 'text',
        source: 'library',
        title: 'HR Screening',
        status: 'created',
        consentId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      },
      recoveryToken: 'rec-1',
    });
    const router = renderSetup();

    await user.click(await screen.findByText('HR Screening'));
    await user.click(screen.getByRole('button', { name: /continue to consent/i }));

    await waitFor(() =>
      expect(createPractice).toHaveBeenCalledWith({ packId: 'hr-screening', mode: 'text' }),
    );
    expect(storePracticeRecovery).toHaveBeenCalledWith('ps-1', 'rec-1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/practice/ps-1/consent'));
  });

  it('builds a JD-targeted mock from pasted text', async () => {
    const user = userEvent.setup();
    const { createPracticeFromJd, storePracticeRecovery } = await import('../api');
    vi.mocked(createPracticeFromJd).mockResolvedValue({
      session: {
        id: 'ps-jd-1',
        accountId: 'acc-1',
        mode: 'text',
        source: 'jd',
        title: 'JD practice: Senior Backend Engineer',
        status: 'created',
        consentId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      },
      recoveryToken: 'rec-jd',
    });
    const router = renderSetup();

    const jdBox = await screen.findByLabelText(/job description/i);
    await user.type(jdBox, 'A'.repeat(60));
    await user.click(screen.getByRole('button', { name: /build my mock/i }));

    await waitFor(() =>
      expect(createPracticeFromJd).toHaveBeenCalledWith({ jdText: 'A'.repeat(60), mode: 'text' }),
    );
    expect(storePracticeRecovery).toHaveBeenCalledWith('ps-jd-1', 'rec-jd');
    await waitFor(() => expect(router.state.location.pathname).toBe('/practice/ps-jd-1/consent'));
  });

  it('shows the daily-cap message on 429', async () => {
    const user = userEvent.setup();
    vi.mocked(createPractice).mockRejectedValue(
      new ApiErrorResponse(
        { statusCode: 429, message: 'daily cap reached' } as never,
        {} as Response,
      ),
    );
    renderSetup();

    await user.click(await screen.findByText('HR Screening'));
    await user.click(screen.getByRole('button', { name: /continue to consent/i }));

    expect(
      await screen.findByText(/hit today’s practice limit/i),
    ).toBeInTheDocument();
  });

  it('starts a voice session when the Voice mode is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(createPractice).mockResolvedValue({
      session: {
        id: 'ps-voice',
        accountId: 'acc-1',
        mode: 'voice',
        source: 'library',
        title: 'HR Screening',
        status: 'created',
        consentId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      },
      recoveryToken: 'rec-voice',
    });
    renderSetup();

    await user.click(await screen.findByText('HR Screening'));
    await user.click(screen.getByRole('button', { name: /^voice/i }));
    await user.click(screen.getByRole('button', { name: /continue to consent/i }));

    await waitFor(() =>
      expect(createPractice).toHaveBeenCalledWith({ packId: 'hr-screening', mode: 'voice' }),
    );
  });

  it('passes the selected mode into the JD flow', async () => {
    const user = userEvent.setup();
    const { createPracticeFromJd } = await import('../api');
    vi.mocked(createPracticeFromJd).mockResolvedValue({
      session: {
        id: 'ps-jd-voice',
        accountId: 'acc-1',
        mode: 'voice',
        source: 'jd',
        title: 'JD practice',
        status: 'created',
        consentId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      },
      recoveryToken: 'rec-jd-voice',
    });
    renderSetup();

    await user.click(await screen.findByRole('button', { name: /^voice/i }));
    const jdBox = screen.getByLabelText(/job description/i);
    await user.type(jdBox, 'A'.repeat(60));
    await user.click(screen.getByRole('button', { name: /build my mock/i }));

    await waitFor(() =>
      expect(createPracticeFromJd).toHaveBeenCalledWith({ jdText: 'A'.repeat(60), mode: 'voice' }),
    );
  });
});
