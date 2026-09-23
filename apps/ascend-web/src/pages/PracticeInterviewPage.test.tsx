import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  fetchWallet: vi.fn(),
  ApiErrorResponse: class extends Error {
    statusCode = 400;
  },
  clearPracticeRecovery: vi.fn(),
  fetchPracticeSession: vi.fn(),
  loadPracticeRecovery: vi.fn(),
  preflightPractice: vi.fn(),
  submitPracticeTurn: vi.fn(),
}));

import {
  clearPracticeRecovery,
  fetchPracticeSession,
  loadPracticeRecovery,
  preflightPractice,
  submitPracticeTurn,
} from '../api';
import { PracticeInterviewPage } from './PracticeInterviewPage';

const liveSession = {
  id: 'ps-1',
  accountId: 'acc-1',
  mode: 'text' as const,
  source: 'library' as const,
  title: 'HR Screening',
  status: 'live',
  consentId: 'c-1',
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
};

function renderInterview(recoveryToken: string | null) {
  vi.mocked(loadPracticeRecovery).mockReturnValue(recoveryToken);
  const router = createMemoryRouter(
    [
      { path: '/practice/:sessionId/interview', element: <PracticeInterviewPage /> },
      { path: '/practice/:sessionId/report', element: <div>REPORT</div> },
    ],
    { initialEntries: ['/practice/ps-1/interview'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('PracticeInterviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(fetchPracticeSession).mockResolvedValue({
      session: liveSession,
      transcript: [],
      questions: [
        { id: 'q1', prompt: 'Tell me about yourself', type: 'open_ended', rubricLines: [] },
      ],
    } as unknown as Awaited<ReturnType<typeof fetchPracticeSession>>);
    vi.mocked(preflightPractice).mockResolvedValue({
      session: liveSession,
      turn: { type: 'question', text: 'Tell me about yourself', questionId: 'q1' },
    });
  });

  it('preflights on mount and submits typed answers', async () => {
    const user = userEvent.setup();
    vi.mocked(submitPracticeTurn).mockResolvedValue({
      session: liveSession,
      turn: { type: 'question', text: 'Why this role?', questionId: 'q2' },
    });
    renderInterview('rec-1');

    expect(await screen.findByText('Tell me about yourself')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/your answer/i), 'I grew the team to twelve.');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() =>
      expect(submitPracticeTurn).toHaveBeenCalledWith('ps-1', 'rec-1', {
        answer: 'I grew the team to twelve.',
      }),
    );
    expect(await screen.findByText('Why this role?')).toBeInTheDocument();
  });

  it('navigates to the report and clears the recovery token on wrapup', async () => {
    const user = userEvent.setup();
    vi.mocked(submitPracticeTurn).mockResolvedValue({
      session: { ...liveSession, status: 'completed' },
      turn: { type: 'wrapup', text: 'That is a wrap — thank you!', questionId: null },
    });
    const router = renderInterview('rec-1');

    await user.type(await screen.findByLabelText(/your answer/i), 'Final answer.');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/practice/ps-1/report'));
    expect(clearPracticeRecovery).toHaveBeenCalledWith('ps-1');
  });

  it('shows a recovery hint when the token is missing from this tab', async () => {
    renderInterview(null);
    expect(await screen.findByText(/mock not found/i)).toBeInTheDocument();
  });
});
