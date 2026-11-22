import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DashboardSummaryResponse } from '@zios/shared-types';
import { DashboardPage } from '../pages/shell/DashboardPage';
import { dashboardApi } from '../lib/dashboard-api';

vi.mock('../lib/dashboard-api', () => ({
  dashboardApi: {
    getSummary: vi.fn(),
    listInterviews: vi.fn(),
  },
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../pages/shell/InviteDialog', () => ({
  InviteDialog: () => null,
}));

vi.mock('../pages/reports/report-pdf', () => ({
  downloadReportPdf: vi.fn(),
}));

import { useAuth } from '../auth/AuthContext';

const mockedGetSummary = vi.mocked(dashboardApi.getSummary);
const mockedUseAuth = vi.mocked(useAuth);

function summary(overrides: Partial<DashboardSummaryResponse> = {}): DashboardSummaryResponse {
  return {
    stats: {
      totalCandidates: 7,
      activeJobs: 2,
      totalInterviews: 5,
      pendingReviews: 1,
      liveNow: 0,
    },
    pipeline: { sourced: 5, applied: 4, screening: 3, technical: 2, final: 1, offers: 0 },
    timeToHireDays: 6,
    awaiting: [
      {
        sessionId: 's1',
        candidateName: 'Awaiting Alice',
        mode: 'text',
        status: 'consented',
        createdAt: '2026-11-22T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedUseAuth.mockReturnValue({
      state: {
        status: 'authenticated',
        user: { id: 'u1', orgId: 'org-1', name: 'Pranav Admin', role: 'admin' },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('renders summary stats, pipeline, greeting, and awaiting list', async () => {
    mockedGetSummary.mockResolvedValue(summary());
    renderPage();

    await waitFor(() => expect(screen.getByText('Total Candidates')).toBeInTheDocument());
    const cardText = (label: string) =>
      screen.getByText(label).closest('div[class*="rounded"]')?.textContent ?? '';
    expect(cardText('Total Candidates')).toContain('7');
    expect(cardText('Active Jobs')).toContain('2');
    expect(cardText('Interviews')).toContain('5');
    expect(cardText('Time to Hire')).toContain('6d');
    expect(screen.getByText('1')).toBeInTheDocument(); // pipeline final
    expect(screen.getByText('Awaiting Alice')).toBeInTheDocument();
    expect(screen.getByText(/1 interview pending score review/)).toBeInTheDocument();
  });

  it('renders empty states when the org has no data', async () => {
    mockedGetSummary.mockResolvedValue(summary({
      stats: {
        totalCandidates: 0,
        activeJobs: 0,
        totalInterviews: 0,
        pendingReviews: 0,
        liveNow: 0,
      },
      pipeline: { sourced: 0, applied: 0, screening: 0, technical: 0, final: 0, offers: 0 },
      timeToHireDays: null,
      awaiting: [],
    }));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('No interviews awaiting candidates')).toBeInTheDocument(),
    );
    expect(screen.getByText('—')).toBeInTheDocument(); // time to hire placeholder
    expect(screen.getByText(/0 interviews pending score review/)).toBeInTheDocument();
  });

  it('renders empty states when the summary call fails', async () => {
    mockedGetSummary.mockRejectedValue(new Error('network down'));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('No interviews awaiting candidates')).toBeInTheDocument(),
    );
  });
});
