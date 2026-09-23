import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWallet: vi.fn(),
  ApiErrorResponse: class extends Error {
    statusCode = 400;
  },
  fetchPracticeReport: vi.fn(),
}));

import { fetchPracticeReport } from '../api';
import { PracticeReportPage } from './PracticeReportPage';

const completedDetail = {
  report: {
    id: 'pr-1',
    sessionId: 'ps-1',
    accountId: 'acc-1',
    status: 'completed' as const,
    overallRecommendation: 4,
    overallConfidence: 0.9,
    communicationMetrics: {
      paceWpm: 140,
      fillerCount: 3,
      paragraphCount: 2,
      avgSentenceLength: 18,
    },
    modelRoute: 'mock:mock-fixture-model',
    errorMessage: null,
    createdAt: new Date().toISOString(),
  },
  scores: [
    {
      id: 's-1',
      reportId: 'pr-1',
      questionId: 'q1',
      criterionId: 'r1',
      criterionText: 'Clarity of structure',
      score: 4,
      weight: 1,
      evidenceSpanIds: ['es-1'],
    },
  ],
  evidenceSpans: [
    {
      id: 'es-1',
      reportId: 'pr-1',
      transcriptId: 't-1',
      questionId: 'q1',
      start: 0,
      end: 42,
      quoteText: 'I grew the team to twelve people',
    },
  ],
  transcript: [
    {
      id: 't-1',
      sessionId: 'ps-1',
      questionId: 'q1',
      questionPrompt: 'Tell me about yourself',
      answerText: 'I grew the team to twelve people across two sites.',
      answerData: null,
      position: 0,
      evidenceSpan: [],
      createdAt: new Date().toISOString(),
      answeredAt: new Date().toISOString(),
    },
  ],
  coachingTips: [
    {
      category: 'fillers' as const,
      tip: 'Pause silently instead of using filler words.',
      quoteText: 'I grew the team to twelve people',
      questionId: 'q1',
    },
  ],
};

function renderReport() {
  const router = createMemoryRouter(
    [{ path: '/practice/:sessionId/report', element: <PracticeReportPage /> }],
    { initialEntries: ['/practice/ps-1/report'] },
  );
  render(<RouterProvider router={router} />);
}

describe('PracticeReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the judging state while the report is pending', async () => {
    vi.mocked(fetchPracticeReport).mockResolvedValue({
      ...completedDetail,
      report: { ...completedDetail.report, status: 'pending' as const },
    });
    renderReport();
    expect(await screen.findByText(/judging your mock/i)).toBeInTheDocument();
  });

  it('renders scores, metrics and evidence-linked coaching tips', async () => {
    vi.mocked(fetchPracticeReport).mockResolvedValue(completedDetail);
    renderReport();

    expect(await screen.findByText('Clarity of structure')).toBeInTheDocument();
    expect(screen.getByText('4/5 · weight 1')).toBeInTheDocument();
    expect(screen.getByText(/140 words\/min/)).toBeInTheDocument();

    // Coach's corner: tip text + its cited quote, and the replay shows the answer.
    expect(screen.getByText('Pause silently instead of using filler words.')).toBeInTheDocument();
    // The same quote appears twice: once in the tip, once in the replay panel.
    expect(screen.getAllByText('“I grew the team to twelve people”').length).toBeGreaterThanOrEqual(2);
    await waitFor(() =>
      expect(
        screen.getByText('I grew the team to twelve people across two sites.'),
      ).toBeInTheDocument(),
    );
  });

  it('renders the failed state without throwing', async () => {
    vi.mocked(fetchPracticeReport).mockResolvedValue({
      ...completedDetail,
      report: {
        ...completedDetail.report,
        status: 'failed' as const,
        errorMessage: 'judge timed out',
      },
    });
    renderReport();
    expect(await screen.findByText(/report failed/i)).toBeInTheDocument();
    expect(screen.getByText(/judge timed out/)).toBeInTheDocument();
  });
});
