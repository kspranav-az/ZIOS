import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  ApiErrorResponse: class extends Error {
    statusCode: number;
    constructor(error?: { statusCode?: number; message?: string }) {
      super(error?.message);
      this.statusCode = error?.statusCode ?? 500;
    }
  },
  fetchWallet: vi.fn(),
}));

import { fetchWallet } from '../api';
import { WalletPage } from './WalletPage';

const wallet = {
  balance: 49,
  lowBalanceThreshold: 5,
  ledger: [
    {
      id: 'e2',
      delta: -1,
      balanceAfter: 49,
      reason: 'practice_start',
      createdAt: new Date('2026-09-23T06:00:00Z').toISOString(),
    },
    {
      id: 'e1',
      delta: 50,
      balanceAfter: 50,
      reason: 'welcome_grant',
      createdAt: new Date('2026-09-23T05:00:00Z').toISOString(),
    },
  ],
};

describe('WalletPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the balance, threshold, and the append-only ledger', async () => {
    vi.mocked(fetchWallet).mockResolvedValue(wallet);
    render(<WalletPage />);

    expect((await screen.findAllByText('49')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/low-balance alert line: 5 credits/i)).toBeInTheDocument();
    expect(screen.getByText('Welcome grant')).toBeInTheDocument();
    expect(screen.getByText('Practice mock')).toBeInTheDocument();
    expect(screen.getByText('+50')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    // Newest first: the practice debit leads the list.
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Practice mock');
  });

  it('shows the closed-beta top-up state at zero balance', async () => {
    vi.mocked(fetchWallet).mockResolvedValue({ ...wallet, balance: 0 });
    render(<WalletPage />);

    expect(await screen.findByText(/you are out of credits/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request a top-up/i })).toBeInTheDocument();
  });

  it('renders an error line when the wallet fails to load', async () => {
    vi.mocked(fetchWallet).mockReset();
    vi.mocked(fetchWallet).mockRejectedValue(new Error('network'));
    render(<WalletPage />);

    expect(await screen.findByText('network')).toBeInTheDocument();
  });
});
