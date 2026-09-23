import { describe, expect, it } from 'vitest';
import type { CommunicationMetrics } from '@zios/shared-types';
import { computeReadiness, computeStreak, READINESS_FORMULA_V1 } from './readiness';

const metrics = (overrides: Partial<CommunicationMetrics>): CommunicationMetrics => ({
  paceWpm: 140,
  fillerCount: 0,
  paragraphCount: 3,
  avgSentenceLength: 16,
  ...overrides,
});

describe('computeReadiness (READINESS_FORMULA_V1)', () => {
  it('returns null readiness with no judged sessions', () => {
    const result = computeReadiness([]);
    expect(result).toEqual({
      formulaVersion: READINESS_FORMULA_V1,
      readiness: null,
      components: null,
      sessionsUsed: 0,
    });
    // Pending/unjudged sessions do not count either.
    expect(computeReadiness([{ overallRecommendation: null, communicationMetrics: null }]).readiness).toBeNull();
  });

  it('scores a perfect session at 100', () => {
    const result = computeReadiness([
      { overallRecommendation: 5, communicationMetrics: metrics({}) },
      { overallRecommendation: 5, communicationMetrics: metrics({}) },
    ]);
    expect(result.readiness).toBe(100);
    expect(result.components).toEqual({
      scoreBlend: 100,
      paceScore: 100,
      fillerScore: 100,
      structureScore: 100,
    });
    expect(result.sessionsUsed).toBe(2);
  });

  it('works with fewer than 5 sessions (< window)', () => {
    const result = computeReadiness([
      { overallRecommendation: 3, communicationMetrics: metrics({}) },
    ]);
    expect(result.readiness).toBe(80); // 0.5*60 + 0.2*100 + 0.15*100 + 0.15*100
    expect(result.sessionsUsed).toBe(1);
  });

  it('penalises out-of-range pace, fillers, and thin structure', () => {
    const result = computeReadiness([
      {
        overallRecommendation: 4,
        communicationMetrics: metrics({ paceWpm: 220, fillerCount: 2, paragraphCount: 1 }),
      },
    ]);
    expect(result.components?.paceScore).toBe(0);
    expect(result.components?.fillerScore).toBe(60);
    expect(result.components?.structureScore).toBe(50);
    expect(result.readiness).toBe(Math.round(0.5 * 80 + 0 + 0.15 * 60 + 0.15 * 50));
  });

  it('treats unjudged sessions as unused but keeps judged ones', () => {
    const result = computeReadiness([
      { overallRecommendation: null, communicationMetrics: null },
      { overallRecommendation: 4, communicationMetrics: metrics({}) },
      { overallRecommendation: 2, communicationMetrics: metrics({ fillerCount: 5 }) },
    ]);
    expect(result.sessionsUsed).toBe(2);
    expect(result.components?.scoreBlend).toBe(60);
    expect(result.components?.fillerScore).toBe(50); // mean 2.5 fillers → 100 - 20*2.5
  });
});

describe('computeStreak', () => {
  it('returns 0 for no sessions', () => {
    expect(computeStreak([])).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect(computeStreak([twoDaysAgo, yesterday, today])).toBe(3);
    expect(computeStreak([twoDaysAgo, today])).toBe(1); // gap breaks the streak
  });

  it('returns 0 when the last session is older than yesterday', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    expect(computeStreak([threeDaysAgo])).toBe(0);
  });

  it('keeps the streak alive through a yesterday-ending run', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect(computeStreak([twoDaysAgo, yesterday])).toBe(2);
  });
});
