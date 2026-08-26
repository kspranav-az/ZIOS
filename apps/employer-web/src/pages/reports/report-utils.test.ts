import { describe, expect, it } from 'vitest';
import type {
  CommunicationMetrics,
  DashboardInterviewItem,
  EvaluationScore,
  EvidenceSpan,
  ScoreOverride,
  SessionStatus,
} from '@zios/shared-types';
import { filterDashboardInterviews } from '../../lib/dashboard-api';
import {
  dashboardRowOverall,
  evidenceForScore,
  formatScore,
  metricsSummary,
  overallRecommendationLabel,
  scoreForDisplay,
  sessionStatusTone,
  sortTimelineStages,
} from './report-utils';

const baseCandidate = {
  id: 'c1',
  orgId: 'o1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  externalRef: null,
  piiVaultRef: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const baseSession = {
  id: 's1',
  inviteId: 'i1',
  kitVersionId: 'kv1',
  mode: 'text' as const,
  conductor: 'ai' as const,
  status: 'completed' as SessionStatus,
  consentId: null,
  preflightReport: {},
  startedAt: null,
  endedAt: null,
  mediaRefs: [],
  integrityEvents: [],
  schemaVersion: 1,
  recoveryTokenHash: null,
  livekitRoomName: null,
  fallbackToTextAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeItem(overrides: Partial<DashboardInterviewItem> = {}): DashboardInterviewItem {
  return {
    session: baseSession,
    candidate: baseCandidate,
    kitTitle: 'Engineering Kit',
    reportStatus: 'completed',
    overallRecommendation: 3.8,
    flags: [],
    isAsyncVideo: false,
    ...overrides,
  };
}

describe('formatScore', () => {
  it('renders one decimal for a number', () => {
    expect(formatScore(3.75)).toBe('3.8');
  });

  it('returns em-dash for null/undefined', () => {
    expect(formatScore(null)).toBe('—');
    expect(formatScore(undefined)).toBe('—');
  });
});

describe('overallRecommendationLabel', () => {
  it.each([
    [4.8, 'Strong hire'],
    [4.0, 'Hire'],
    [3.2, 'Lean hire'],
    [2.0, 'Lean no-hire'],
    [0.5, 'No-hire'],
    [null, 'No recommendation'],
  ])('maps %s to "%s"', (value, expected) => {
    expect(overallRecommendationLabel(value as number | null)).toBe(expected);
  });
});

describe('sessionStatusTone', () => {
  it('marks completed states as success', () => {
    expect(sessionStatusTone('completed')).toBe('success');
    expect(sessionStatusTone('reported')).toBe('success');
    expect(sessionStatusTone('reviewed')).toBe('success');
  });

  it('marks abandoned as error', () => {
    expect(sessionStatusTone('abandoned')).toBe('error');
  });

  it('marks invited as warning', () => {
    expect(sessionStatusTone('invited')).toBe('warning');
  });

  it('defaults to neutral', () => {
    expect(sessionStatusTone('live')).toBe('neutral');
  });
});

describe('sortTimelineStages', () => {
  it('marks current stage active and prior stages done', () => {
    const stages = sortTimelineStages('live');
    expect(stages[0]?.status).toBe('done');
    expect(stages[1]?.status).toBe('done');
    expect(stages[2]?.status).toBe('done');
    expect(stages[3]?.status).toBe('active');
    expect(stages[4]?.status).toBe('pending');
  });
});

describe('scoreForDisplay', () => {
  it('returns the original score when no override exists', () => {
    const score = { id: 'sc1', score: 4 } as EvaluationScore;
    const result = scoreForDisplay(score, []);
    expect(result.value).toBe(4);
    expect(result.isOverridden).toBe(false);
  });

  it('returns the override score when one exists', () => {
    const score = { id: 'sc1', score: 4 } as EvaluationScore;
    const overrides = [
      { scoreId: 'sc1', newScore: 2, reasonCode: 'EVIDENCE_MISSED' } as ScoreOverride,
    ];
    const result = scoreForDisplay(score, overrides);
    expect(result.value).toBe(2);
    expect(result.isOverridden).toBe(true);
  });
});

describe('evidenceForScore', () => {
  it('returns only spans referenced by the score', () => {
    const score = { id: 'sc1', evidenceSpanIds: ['span-1'] } as EvaluationScore;
    const spans = [
      { id: 'span-1', quoteText: 'yes' } as EvidenceSpan,
      { id: 'span-2', quoteText: 'no' } as EvidenceSpan,
    ];
    expect(evidenceForScore(score, spans)).toHaveLength(1);
    expect(evidenceForScore(score, spans)[0]?.id).toBe('span-1');
  });
});

describe('metricsSummary', () => {
  it('joins all metrics into a readable string', () => {
    const metrics: CommunicationMetrics = {
      paceWpm: 125.7,
      fillerCount: 3,
      paragraphCount: 2,
      avgSentenceLength: 14.5,
    };
    expect(metricsSummary(metrics)).toBe(
      '126 WPM · 3 fillers · 2 paragraphs · 14.5 words/sentence',
    );
  });
});

describe('dashboardRowOverall', () => {
  it('renders score for a completed report', () => {
    const item = makeItem();
    const result = dashboardRowOverall(item);
    expect(result.value).toBe('3.8');
    expect(result.tone).toBe('success');
  });

  it('renders pending state', () => {
    const item = makeItem({ reportStatus: 'pending', overallRecommendation: null });
    const result = dashboardRowOverall(item);
    expect(result.value).toBe('…');
    expect(result.tone).toBe('warning');
  });

  it('renders failed state', () => {
    const item = makeItem({ reportStatus: 'failed', overallRecommendation: null });
    const result = dashboardRowOverall(item);
    expect(result.value).toBe('—');
    expect(result.tone).toBe('error');
  });
});

describe('filterDashboardInterviews', () => {
  const items = [
    makeItem({ candidate: { ...baseCandidate, name: 'Alice', email: 'alice@example.com' } }),
    makeItem({ candidate: { ...baseCandidate, name: 'Bob', email: 'bob@example.com' } }),
  ];

  it('filters by free-text query across name, email and kit title', () => {
    expect(filterDashboardInterviews(items, { q: 'alice' })).toHaveLength(1);
    expect(filterDashboardInterviews(items, { q: 'Engineering' })).toHaveLength(2);
  });

  it('filters by session status', () => {
    const mixed = [makeItem(), makeItem({ session: { ...baseSession, status: 'invited' } })];
    expect(filterDashboardInterviews(mixed, { status: 'invited' })).toHaveLength(1);
  });
});
