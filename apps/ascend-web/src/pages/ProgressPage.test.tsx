import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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
  fetchProgress: vi.fn(),
}));

import { fetchProgress } from '../api';
import { ProgressPage } from './ProgressPage';

function renderPage() {
  const router = createMemoryRouter([{ path: '/progress', element: <ProgressPage /> }], {
    initialEntries: ['/progress'],
  });
  render(<RouterProvider router={router} />);
}

const emptyProgress = {
  sessions: [],
  trends: [],
  streak: { current: 0 },
  dailyCap: 3,
};

describe('ProgressPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state with a start button when no mocks exist', async () => {
    vi.mocked(fetchProgress).mockResolvedValue(emptyProgress);
    renderPage();

    expect(await screen.findByText(/no mocks yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start your first mock/i })).toBeInTheDocument();
    // Both stat cards read zero: mocks completed and streak.
    expect(screen.getAllByText('0').length).toBe(2);
  });

  it('renders streak, trend, and session history for completed mocks', async () => {
    vi.mocked(fetchProgress).mockResolvedValue({
      sessions: [
        {
          id: 's1',
          title: 'HR screening',
          source: 'library',
          status: 'completed',
          createdAt: new Date('2026-09-23T05:00:00Z').toISOString(),
          completedAt: new Date('2026-09-23T05:30:00Z').toISOString(),
          overallRecommendation: 4,
        },
      ],
      trends: [
        {
          completedAt: new Date('2026-09-23T05:30:00Z').toISOString(),
          overallRecommendation: 4,
          paceWpm: 142,
          fillerCount: 2,
        },
      ],
      streak: { current: 1 },
      dailyCap: 3,
    });
    renderPage();

    expect(await screen.findByText(/score trend/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /score trend/i })).toBeInTheDocument();
    expect(screen.getByText(/142 wpm/i)).toBeInTheDocument();
    expect(screen.getByText(/2 fillers/i)).toBeInTheDocument();
    // Streak card reads 1 day.
    expect(screen.getByText(/day\(s\)/i)).toBeInTheDocument();
    expect(screen.getByText('HR screening')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /report/i })).toHaveAttribute(
      'href',
      '/practice/s1/report',
    );
  });
});
