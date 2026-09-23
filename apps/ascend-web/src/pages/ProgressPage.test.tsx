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
  fetchHistory: vi.fn(),
}));

import { fetchHistory } from '../api';
import { ProgressPage } from './ProgressPage';

function renderPage() {
  const router = createMemoryRouter([{ path: '/progress', element: <ProgressPage /> }], {
    initialEntries: ['/progress'],
  });
  render(<RouterProvider router={router} />);
}

const emptyHistory = {
  practice: { sessions: [], trends: [], streak: { current: 0 }, dailyCap: 3 },
  company: [],
};

describe('ProgressPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state with a start button when no mocks exist', async () => {
    vi.mocked(fetchHistory).mockResolvedValue(emptyHistory);
    renderPage();

    expect(await screen.findByText(/no mocks yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start your first mock/i })).toBeInTheDocument();
    expect(screen.getByText(/no company interviews linked to this email yet/i)).toBeInTheDocument();
    // Both stat cards read zero: mocks completed and streak.
    expect(screen.getAllByText('0').length).toBe(2);
  });

  it('renders streak, trend, and session history for completed mocks', async () => {
    vi.mocked(fetchHistory).mockResolvedValue({
      practice: {
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
      },
      company: [],
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

  it('renders the company interviews section with org, role, and status chip', async () => {
    vi.mocked(fetchHistory).mockResolvedValue({
      practice: emptyHistory.practice,
      company: [
        {
          sessionId: 'co-1',
          orgName: 'ZeTheta Robotics',
          roleTitle: 'Backend Engineer',
          mode: 'video',
          status: 'completed',
          startedAt: '2026-09-20T10:00:00.000Z',
          completedAt: '2026-09-20T10:20:00.000Z',
          reportAvailable: false,
        },
        {
          sessionId: 'co-2',
          orgName: 'Acme Corp',
          roleTitle: null,
          mode: 'voice',
          status: 'invited',
          startedAt: null,
          completedAt: null,
          reportAvailable: false,
        },
      ],
    });
    renderPage();

    expect(
      await screen.findByText(
        (content, el) => el?.tagName === 'P' && content.includes('ZeTheta Robotics'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
    expect(
      screen.getByText((content, el) => el?.tagName === 'P' && content.includes('Acme Corp')),
    ).toBeInTheDocument();
    expect(screen.getByText('Interview')).toBeInTheDocument();
    // Both status chips render; the completed one is the primary chip.
    expect(screen.getAllByText('completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('invited')).toBeInTheDocument();
  });
});
