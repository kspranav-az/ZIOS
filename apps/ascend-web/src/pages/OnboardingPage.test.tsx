import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  ApiErrorResponse: class extends Error {},
  patchMe: vi.fn(),
}));

import { patchMe } from '../api';
import { OnboardingPage } from './OnboardingPage';

function renderOnboarding() {
  const router = createMemoryRouter([{ path: '/onboarding', element: <OnboardingPage /> }], {
    initialEntries: ['/onboarding'],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves name and target role, then navigates home', async () => {
    const user = userEvent.setup();
    vi.mocked(patchMe).mockResolvedValue({
      account: {
        id: 'acc-1',
        email: 'priya@example.com',
        phone: null,
        name: 'Priya',
        targetRole: 'Backend Engineer',
        onboarding: { onboarded: true },
        marketingOptIn: false,
        createdAt: new Date().toISOString(),
      },
    });
    const router = renderOnboarding();

    await user.type(screen.getByLabelText(/your name/i), 'Priya');
    await user.type(screen.getByLabelText(/target role/i), 'Backend Engineer');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() =>
      expect(patchMe).toHaveBeenCalledWith({ name: 'Priya', targetRole: 'Backend Engineer' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('requires a name before submitting', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).toBeDisabled();
    expect(patchMe).not.toHaveBeenCalled();
    await user.click(button);
    expect(patchMe).not.toHaveBeenCalled();
  });
});
