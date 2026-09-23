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
  submitPracticeAudio: vi.fn(),
  submitPracticeTurn: vi.fn(),
}));

import {
  clearPracticeRecovery,
  fetchPracticeSession,
  loadPracticeRecovery,
  preflightPractice,
  submitPracticeAudio,
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

const liveVoiceSession = { ...liveSession, mode: 'voice' as const };

/** Minimal MediaRecorder double: captures start/stop and emits one chunk. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  stream = { getTracks: () => [{ stop: vi.fn() }] };
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  static isTypeSupported(): boolean {
    return true;
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function stubMediaDevices(): void {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
}

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

  describe('voice mode (Phase 12b record → transcribe → submit)', () => {
    beforeEach(() => {
      stubMediaDevices();
      FakeMediaRecorder.instances = [];
      vi.mocked(fetchPracticeSession).mockResolvedValue({
        session: liveVoiceSession,
        transcript: [],
        questions: [
          { id: 'q1', prompt: 'Tell me about yourself', type: 'open_ended', rubricLines: [] },
        ],
      } as unknown as Awaited<ReturnType<typeof fetchPracticeSession>>);
      vi.mocked(preflightPractice).mockResolvedValue({
        session: liveVoiceSession,
        turn: { type: 'question', text: 'Tell me about yourself', questionId: 'q1' },
      });
    });

    it('records, transcribes into the editable box, and submits with the recording ref', async () => {
      const user = userEvent.setup();
      vi.mocked(submitPracticeAudio).mockResolvedValue({
        transcript: 'I led the migration and cut failed transactions forty percent.',
        objectName: 'practice-recordings/ps-1/abc/checksum.webm',
      });
      vi.mocked(submitPracticeTurn).mockResolvedValue({
        session: liveVoiceSession,
        turn: { type: 'question', text: 'Why this role?', questionId: 'q2' },
      });
      renderInterview('rec-1');

      await user.click(await screen.findByRole('button', { name: /^record$/i }));
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording');
      await user.click(screen.getByRole('button', { name: /^stop$/i }));

      // Transcript lands in the editable textarea.
      const box = await screen.findByLabelText(/your answer/i);
      await waitFor(() =>
        expect(box).toHaveValue('I led the migration and cut failed transactions forty percent.'),
      );
      expect(screen.getByText(/recording attached/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /submit answer/i }));
      await waitFor(() =>
        expect(submitPracticeTurn).toHaveBeenCalledWith('ps-1', 'rec-1', {
          answer: 'I led the migration and cut failed transactions forty percent.',
          recordingRef: 'practice-recordings/ps-1/abc/checksum.webm',
        }),
      );
    });

    it('shows a friendly error when the mic is denied and falls back to typing', async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
      });
      renderInterview('rec-1');

      await user.click(await screen.findByRole('button', { name: /^record$/i }));
      expect(
        await screen.findByText(/microphone access was denied/i),
      ).toBeInTheDocument();
      // Typing still works.
      await user.type(screen.getByLabelText(/your answer/i), 'Typed fallback.');
      expect(screen.getByLabelText(/your answer/i)).toHaveValue('Typed fallback.');
    });
  });
});
