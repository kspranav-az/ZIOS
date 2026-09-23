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
  fetchMe: vi.fn(),
  fetchReadiness: vi.fn(),
  logout: vi.fn(),
}));

import { fetchMe, fetchReadiness } from '../api';
import { HomePage } from './HomePage';

const account = {
  id: 'cand-1',
  email: 'priya@example.com',
  name: 'Priya',
  targetRole: 'Backend Engineer',
  marketingOptIn: false,
  createdAt: new Date('2026-09-23T05:00:00Z').toISOString(),
};

function renderPage() {
  const router = createMemoryRouter([{ path: '/', element: <HomePage /> }], {
    initialEntries: ['/'],
  });
  render(<RouterProvider router={router} />);
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the readiness empty state before any judged mock', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ account });
    vi.mocked(fetchReadiness).mockResolvedValue({
      formulaVersion: 'READINESS_FORMULA_V1',
      readiness: null,
      components: null,
      sessionsUsed: 0,
    });
    renderPage();

    expect(await screen.findByText(/run a mock to get your first readiness score/i)).toBeInTheDocument();
  });

  it('shows the readiness score with component breakdown after judged mocks', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ account });
    vi.mocked(fetchReadiness).mockResolvedValue({
      formulaVersion: 'READINESS_FORMULA_V1',
      readiness: 72,
      components: { scoreBlend: 70, paceScore: 80, fillerScore: 60, structureScore: 75 },
      sessionsUsed: 2,
    });
    renderPage();

    expect(await screen.findByText('72')).toBeInTheDocument();
    expect(screen.getByText('Answer quality')).toBeInTheDocument();
    expect(screen.getByText('Pace')).toBeInTheDocument();
    expect(screen.getByText('Filler words')).toBeInTheDocument();
    expect(screen.getByText('Structure')).toBeInTheDocument();
    expect(screen.getByText(/from your last 2 judged mocks/i)).toBeInTheDocument();
  });
});
