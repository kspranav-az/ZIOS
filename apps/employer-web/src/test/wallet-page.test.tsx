import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletPage } from '../pages/shell/WalletPage';
import { fetchWallet, setLowBalanceThreshold } from '../lib/credits-api';
import type { WalletView } from '../lib/credits-api';

vi.mock('../lib/credits-api', () => ({
  fetchWallet: vi.fn(),
  setLowBalanceThreshold: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: vi.fn() }),
}));

import { useAuth } from '../auth/AuthContext';

const mockedFetch = vi.mocked(fetchWallet);
const mockedSetThreshold = vi.mocked(setLowBalanceThreshold);
const mockedUseAuth = vi.mocked(useAuth);

function walletView(overrides: Partial<WalletView> = {}): WalletView {
  return {
    balance: 40,
    lowBalanceThreshold: 5,
    pricing: { text: 1, voice: 2, video: 3, human: 1, async_video: 3 },
    ledger: [
      {
        id: 'entry-1',
        orgId: 'org-1',
        delta: -2,
        balanceAfter: 42,
        reason: 'session_start',
        sessionRef: 'session-1',
        metadata: { mode: 'voice' },
        createdAt: '2026-09-22T10:00:00Z',
      },
      {
        id: 'entry-2',
        orgId: 'org-1',
        delta: 50,
        balanceAfter: 44,
        reason: 'admin_grant',
        sessionRef: null,
        metadata: {},
        createdAt: '2026-09-21T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

function authAs(role: 'admin' | 'interviewer') {
  mockedUseAuth.mockReturnValue({
    state: { status: 'authenticated', user: { role }, org: { id: 'org-1' } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WalletPage', () => {
  it('shows balance, pricing, and the append-only ledger', async () => {
    authAs('interviewer');
    mockedFetch.mockResolvedValue(walletView());
    render(<WalletPage />);

    await waitFor(() => expect(screen.getByText('40')).toBeInTheDocument());
    expect(screen.getByText('Text interview')).toBeInTheDocument();
    // video and async_video are both priced at 3 cr.
    expect(screen.getAllByText('3 cr')).toHaveLength(2);
    expect(screen.getByText('session_start')).toBeInTheDocument();
    expect(screen.getByText('admin_grant')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.getByText('+50')).toBeInTheDocument();
    // Interviewers cannot edit the threshold.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('flags low balance and lets admins change the threshold', async () => {
    authAs('admin');
    mockedFetch.mockResolvedValue(walletView({ balance: 3, lowBalanceThreshold: 5 }));
    mockedSetThreshold.mockResolvedValue({ lowBalanceThreshold: 2 });
    const user = userEvent.setup();
    render(<WalletPage />);

    await waitFor(() => expect(screen.getByText('Low balance')).toBeInTheDocument());
    const input = screen.getByLabelText('Low-balance threshold');
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedSetThreshold).toHaveBeenCalledWith(2));
  });
});
