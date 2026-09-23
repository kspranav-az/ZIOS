import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWallet: vi.fn(),
  ApiErrorResponse: class extends Error {
    statusCode = 400;
  },
  consentPractice: vi.fn(),
  fetchPracticeLibrary: vi.fn(),
}));

import { consentPractice, fetchPracticeLibrary } from '../api';
import { PracticeConsentPage } from './PracticeConsentPage';

function renderConsent() {
  const router = createMemoryRouter(
    [
      { path: '/practice/:sessionId/consent', element: <PracticeConsentPage /> },
      { path: '/practice/:sessionId/interview', element: <div>INTERVIEW</div> },
    ],
    { initialEntries: ['/practice/ps-1/consent'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('PracticeConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPracticeLibrary).mockResolvedValue({
      packs: [],
      consent: { version: 'PRACTICE_CONSENT_TEXT_V1', text: 'We record your answers.' },
    });
    vi.mocked(consentPractice).mockResolvedValue({ session: {} });
  });

  it('shows the consent text and blocks start until recording consent is given', async () => {
    const user = userEvent.setup();
    renderConsent();

    expect(await screen.findByText(/we record your answers/i)).toBeInTheDocument();
    const start = screen.getByRole('button', { name: /i consent — start the mock/i });
    expect(start).toBeDisabled();

    await user.click(screen.getByTestId('consent-recording'));
    expect(start).toBeEnabled();

    await user.click(start);
    await waitFor(() =>
      expect(consentPractice).toHaveBeenCalledWith('ps-1', {
        recordingAllowed: true,
        modelOptIn: false,
      }),
    );
  });

  it('routes to the interview after consent is stored', async () => {
    const user = userEvent.setup();
    const router = renderConsent();

    await user.click(await screen.findByTestId('consent-recording'));
    await user.click(screen.getByRole('button', { name: /i consent — start the mock/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/practice/ps-1/interview'));
  });
});
