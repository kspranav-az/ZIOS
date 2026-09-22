import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AnalysisFeaturesPanel,
  formatMeasurementValue,
  humanizeReason,
  QuestionAnalysisFeatures,
} from '../components/analysis-features-panel';
import type { InterviewFeatures, Measurement } from '../lib/analysis-api';

vi.mock('../lib/analysis-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/analysis-api')>();
  return { ...original, getQuestionFeatures: vi.fn() };
});

import { getQuestionFeatures } from '../lib/analysis-api';
import { ApiRequestError } from '../lib/api';

const mockedGetQuestionFeatures = vi.mocked(getQuestionFeatures);

beforeEach(() => {
  mockedGetQuestionFeatures.mockReset();
});

function valid(value: number, heuristic = false): Measurement {
  return { value, valid: true, heuristic };
}

function invalid(reason: string): Measurement {
  return { value: null, valid: false, reason };
}

function makeFeatures(): InterviewFeatures {
  return {
    schema_version: '1.0.0',
    session_id: 'sess-1',
    question_id: 'q-1',
    media_kind: 'video',
    visual: {
      face_visible_ratio: valid(0.62),
      camera_gaze_ratio: valid(0.874),
      head_yaw_mean: valid(-3.24),
    },
    body: {},
    hands: {},
    speech: {
      speaking_time: valid(42.36),
      wpm_mean: valid(145.6),
      filler_count: valid(7, true),
    },
    voice: {
      pitch_mean: valid(118.4),
    },
    interaction: {
      talk_ratio: invalid('single_speaker_recording'),
      interruption_count: invalid('single_speaker_recording'),
    },
    quality: {
      resolution: valid(921600),
    },
  };
}

async function openGroup(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name }));
}

describe('formatMeasurementValue', () => {
  it('formats ratios as integer percents', () => {
    expect(formatMeasurementValue(0.874, 'ratio')).toBe('87%');
    expect(formatMeasurementValue(0, 'ratio')).toBe('0%');
  });

  it('formats times in seconds with one decimal', () => {
    expect(formatMeasurementValue(42.36, 'seconds')).toBe('42.4 s');
  });

  it('formats Hz and wpm as integers', () => {
    expect(formatMeasurementValue(118.4, 'hz')).toBe('118 Hz');
    expect(formatMeasurementValue(145.6, 'wpm')).toBe('146 wpm');
  });

  it('formats pixels with grouping', () => {
    expect(formatMeasurementValue(921600, 'pixels')).toBe('921,600 px');
  });
});

describe('humanizeReason', () => {
  it('turns snake_case into a sentence', () => {
    expect(humanizeReason('single_speaker_recording')).toBe('Single speaker recording');
  });
});

describe('AnalysisFeaturesPanel', () => {
  it('renders collapsible group sections, collapsed by default', () => {
    render(<AnalysisFeaturesPanel features={makeFeatures()} />);
    for (const name of ['Visual', 'Speech', 'Voice', 'Interaction', 'Quality']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
    }
    // Collapsed groups do not render their rows.
    expect(screen.queryByText('Camera gaze')).not.toBeInTheDocument();
  });

  it('shows formatted values when a group is expanded', async () => {
    render(<AnalysisFeaturesPanel features={makeFeatures()} />);
    await openGroup('Visual');
    expect(screen.getByText('Camera gaze')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('-3.2°')).toBeInTheDocument();

    await openGroup('Speech');
    expect(screen.getByText('42.4 s')).toBeInTheDocument();
    expect(screen.getByText('146 wpm')).toBeInTheDocument();

    await openGroup('Voice');
    expect(screen.getByText('118 Hz')).toBeInTheDocument();

    await openGroup('Quality');
    expect(screen.getByText('921,600 px')).toBeInTheDocument();
  });

  it('renders invalid measurements as muted n/a with a humanized reason', async () => {
    render(<AnalysisFeaturesPanel features={makeFeatures()} />);
    await openGroup('Interaction');
    const na = screen.getAllByText('n/a — Single speaker recording');
    expect(na).toHaveLength(2);
  });

  it('marks heuristic measurements with a badge', async () => {
    render(<AnalysisFeaturesPanel features={makeFeatures()} />);
    await openGroup('Speech');
    expect(screen.getByText('heuristic')).toBeInTheDocument();
  });

  it('collapses an open group when toggled again', async () => {
    render(<AnalysisFeaturesPanel features={makeFeatures()} />);
    await openGroup('Visual');
    expect(screen.getByText('Camera gaze')).toBeInTheDocument();
    await openGroup('Visual');
    expect(screen.queryByText('Camera gaze')).not.toBeInTheDocument();
  });
});

describe('QuestionAnalysisFeatures', () => {
  it('renders the panel once features load', async () => {
    mockedGetQuestionFeatures.mockResolvedValue({
      sessionId: 'sess-1',
      questionId: 'q-1',
      analysisJobId: 'job-1',
      schemaVersion: '1.0.0',
      features: makeFeatures(),
      media: null,
      completedAt: null,
    });
    render(<QuestionAnalysisFeatures sessionId="sess-1" questionId="q-1" />);
    await waitFor(() => expect(screen.getByTestId('analysis-features-panel')).toBeInTheDocument());
    expect(mockedGetQuestionFeatures).toHaveBeenCalledWith('sess-1', 'q-1');
  });

  it('shows a subtle empty state on 404 ANALYSIS_NOT_FOUND', async () => {
    mockedGetQuestionFeatures.mockRejectedValue(
      new ApiRequestError(404, 'ANALYSIS_NOT_FOUND', 'no completed analysis'),
    );
    render(<QuestionAnalysisFeatures sessionId="sess-1" questionId="q-1" />);
    await waitFor(() => expect(screen.getByText('Analysis not available yet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows an inline retry on other errors and refetches on click', async () => {
    mockedGetQuestionFeatures
      .mockRejectedValueOnce(new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server.'))
      .mockResolvedValueOnce({
        sessionId: 'sess-1',
        questionId: 'q-1',
        analysisJobId: 'job-1',
        schemaVersion: '1.0.0',
        features: makeFeatures(),
        media: null,
        completedAt: null,
      });
    const user = userEvent.setup();
    render(<QuestionAnalysisFeatures sessionId="sess-1" questionId="q-1" />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    await user.click(retry);
    await waitFor(() => expect(screen.getByTestId('analysis-features-panel')).toBeInTheDocument());
    expect(mockedGetQuestionFeatures).toHaveBeenCalledTimes(2);
  });
});
