import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  ApiErrorResponse: class extends Error {
    statusCode = 400;
  },
  fetchMe: vi.fn(),
  fetchWallet: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../auth', () => ({
  clearToken: vi.fn(),
  getToken: vi.fn(() => 'token'),
  setToken: vi.fn(),
}));

import { fetchMe, fetchWallet, logout } from '../api';
import { clearToken } from '../auth';
import { AscendLayout } from './AscendLayout';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AscendLayout />}>
          <Route path="*" element={<div>page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AscendLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMe).mockResolvedValue({
      account: {
        id: 'acc-1',
        email: 'ada@example.com',
        phone: null,
        name: 'Ada Lovelace',
        targetRole: 'Backend Engineer',
        onboarding: {},
        marketingOptIn: false,
        createdAt: new Date().toISOString(),
      },
    });
    vi.mocked(fetchWallet).mockRejectedValue(new Error('no wallet in test'));
    vi.mocked(logout).mockResolvedValue(undefined);
  });

  it('renders the sidebar nav with all five chrome destinations', async () => {
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    for (const label of ['Home', 'Practice', 'Progress', 'Resume', 'Wallet']) {
      expect(nav).toHaveTextContent(label);
    }
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('marks the active route in the sidebar', async () => {
    renderAt('/progress');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    const active = nav.querySelector('.border-l-4');
    expect(active).toHaveTextContent('Progress');
  });

  it('keeps Home inactive on non-index routes (end match)', async () => {
    renderAt('/wallet');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    const active = nav.querySelector('.border-l-4');
    expect(active).not.toHaveTextContent('Home');
    expect(active).toHaveTextContent('Wallet');
  });

  it('logs out, clears the session token, and redirects to /login', async () => {
    renderAt('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /log out/i }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(clearToken).toHaveBeenCalled();
  });
});
