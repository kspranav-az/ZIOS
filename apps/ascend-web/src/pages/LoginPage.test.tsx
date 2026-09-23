import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWallet: vi.fn(),
  ApiErrorResponse: class extends Error {},
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

import { requestOtp, verifyOtp } from '../api';
import { LoginPage } from './LoginPage';

function renderLogin() {
  const router = createMemoryRouter([{ path: '/login', element: <LoginPage /> }], {
    initialEntries: ['/login'],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('requests a code for the email and moves to the verify step', async () => {
    const user = userEvent.setup();
    vi.mocked(requestOtp).mockResolvedValue({ ok: true, expiresInSeconds: 600, resendAvailableInSeconds: 60 });
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'priya@example.com');
    await user.click(screen.getByRole('button', { name: /send sign-in code/i }));

    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('priya@example.com'));
    expect(await screen.findByText(/enter your sign-in code/i)).toBeInTheDocument();
  });

  it('stores the token and routes new users to onboarding after verify', async () => {
    const user = userEvent.setup();
    vi.mocked(requestOtp).mockResolvedValue({ ok: true, expiresInSeconds: 600, resendAvailableInSeconds: 60 });
    vi.mocked(verifyOtp).mockResolvedValue({
      session: { token: 'cand-token-1', expiresAt: new Date().toISOString() },
      isNewUser: true,
      account: {
        id: 'acc-1',
        email: 'priya@example.com',
        phone: null,
        name: '',
        targetRole: null,
        onboarding: {},
        marketingOptIn: false,
        createdAt: new Date().toISOString(),
      },
    });
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'priya@example.com');
    await user.click(screen.getByRole('button', { name: /send sign-in code/i }));
    await screen.findByText(/enter your sign-in code/i);

    // Fill each OTP box with "123456" via keyboard.
    const boxes = screen.getAllByRole('textbox');
    expect(boxes.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 6; i += 1) {
      await user.type(boxes[i]!, '123456'[i]!);
    }

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('priya@example.com', '123456'));
    expect(sessionStorage.getItem('ascend_session_token')).toBe('cand-token-1');
  });
});
