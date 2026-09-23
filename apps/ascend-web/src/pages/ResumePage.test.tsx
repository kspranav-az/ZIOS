import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  fetchResume: vi.fn(),
  uploadResume: vi.fn(),
  deleteResume: vi.fn(),
  matchResume: vi.fn(),
}));

import { deleteResume, fetchResume, matchResume, uploadResume } from '../api';
import { ResumePage } from './ResumePage';

const RESUME_TEXT = `Priya Sharma
priya@example.com

Skills:
- Python
- PostgreSQL

Experience:
- Led a team of 5 engineers
- Cut latency by 40 percent
`;

const parsedResume = {
  id: 'cr-1',
  fileName: 'priya.txt',
  parsed: {
    name: 'Priya Sharma',
    email: 'priya@example.com',
    phone: null,
    skills: ['Python', 'PostgreSQL'],
    experiences: [
      {
        title: 'Senior Backend Engineer',
        company: 'Zylo',
        duration: '2021 - present',
        highlights: ['Led a team of 5 engineers', 'Cut latency by 40 percent'],
      },
    ],
    education: [],
    certifications: [],
    summary: 'Backend engineer with 6 years of experience.',
  },
  atsReport: {
    score: 85,
    issues: [
      {
        severity: 'medium' as const,
        section: 'summary',
        issue: 'No summary line.',
        fix: 'Add one sentence naming your role and specialty.',
      },
    ],
  },
  updatedAt: new Date().toISOString(),
};

describe('ResumePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an empty state when no resume is on file', async () => {
    vi.mocked(fetchResume).mockRejectedValue(
      new (await import('../api')).ApiErrorResponse({ statusCode: 404 } as never, {} as Response),
    );
    render(<ResumePage />);
    expect(await screen.findByLabelText(/or paste resume text/i)).toBeInTheDocument();
    expect(screen.queryByText(/ats readiness/i)).not.toBeInTheDocument();
  });

  it('uploads pasted text and renders the ATS card', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchResume).mockRejectedValue(new Error('network'));
    vi.mocked(uploadResume).mockResolvedValue(parsedResume);
    render(<ResumePage />);

    await user.type(await screen.findByLabelText(/or paste resume text/i), RESUME_TEXT);
    await user.click(screen.getByRole('button', { name: /parse resume/i }));

    await waitFor(() =>
      expect(uploadResume).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'resume.txt' }),
      ),
    );
    expect(await screen.findByText('ATS readiness')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText(/no summary line/i)).toBeInTheDocument();
    expect(screen.getByText(/backend engineer with 6 years/i)).toBeInTheDocument();
  });

  it('runs a JD match and flags honest rewrites', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchResume).mockResolvedValue(parsedResume);
    vi.mocked(matchResume).mockResolvedValue({
      coverage: [
        { keyword: 'python', present: true, evidence: 'Python' },
        { keyword: 'terraform', present: false, evidence: null },
      ],
      missingKeywords: ['terraform'],
      suggestions: [
        {
          original: 'Led a team of 5 engineers',
          improved: 'Led a team of 5 engineers across payments.',
          honestyFlags: [],
        },
        {
          original: 'Worked on the API.',
          improved: 'Owned the API serving 10k RPM.',
          honestyFlags: ['fabricated-metric:10'],
        },
      ],
    });
    render(<ResumePage />);

    expect(await screen.findByText('ATS readiness')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/job description/i), 'A'.repeat(60));
    await user.click(screen.getByRole('button', { name: /analyse match/i }));

    expect(await screen.findByTestId('match-result')).toBeInTheDocument();
    expect(screen.getByText(/missing: terraform/i)).toBeInTheDocument();
    expect(screen.getByText(/numbers not in your resume/i)).toBeInTheDocument();
  });

  it('erases the resume on demand', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchResume).mockResolvedValue(parsedResume);
    vi.mocked(deleteResume).mockResolvedValue({ ok: true });
    render(<ResumePage />);

    await user.click(await screen.findByRole('button', { name: /erase resume/i }));
    await waitFor(() => expect(deleteResume).toHaveBeenCalled());
    expect(await screen.findByText(/resume erased/i)).toBeInTheDocument();
  });
});
