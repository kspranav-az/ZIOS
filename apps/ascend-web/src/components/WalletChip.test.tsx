import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  ApiErrorResponse: class extends Error {
    statusCode = 400;
  },
  fetchWallet: vi.fn(),
}));

import { fetchWallet } from '../api';
import { WalletChip } from './WalletChip';

describe('WalletChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the live credit balance from /cand/wallet', async () => {
    vi.mocked(fetchWallet).mockResolvedValue({ balance: 49, lowBalanceThreshold: 5 });
    render(<WalletChip />);
    expect(await screen.findByTestId('wallet-balance')).toHaveTextContent('49');
  });

  it('renders nothing while the wallet is loading or on error', async () => {
    vi.mocked(fetchWallet).mockRejectedValue(new Error('network'));
    const { container } = render(<WalletChip />);
    await waitFor(() => expect(fetchWallet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
