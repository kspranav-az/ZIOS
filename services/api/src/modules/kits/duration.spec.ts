import { describe, expect, it } from 'vitest';
import { DEFAULT_QUESTION_SECONDS, estimateDuration } from './duration';

describe('estimateDuration', () => {
  it('returns zeroes for an empty kit', () => {
    const estimate = estimateDuration([]);
    expect(estimate).toEqual({
      questionCount: 0,
      baseSeconds: 0,
      estimatedSeconds: 0,
      perQuestion: [],
    });
  });

  it('applies the 120s default when a question has no time limit', () => {
    const estimate = estimateDuration([{ id: 'q1', timeLimitSec: null }]);
    expect(estimate.baseSeconds).toBe(DEFAULT_QUESTION_SECONDS);
    expect(estimate.perQuestion).toEqual([{ questionId: 'q1', seconds: 120 }]);
  });

  it('sums explicit limits and adds 20% overhead, rounded', () => {
    const estimate = estimateDuration([
      { id: 'q1', timeLimitSec: 60 },
      { id: 'q2', timeLimitSec: 90 },
      { id: 'q3', timeLimitSec: null },
    ]);
    expect(estimate.questionCount).toBe(3);
    expect(estimate.baseSeconds).toBe(270);
    expect(estimate.estimatedSeconds).toBe(Math.round(270 * 1.2));
  });

  it('rounds the overhead estimate to whole seconds', () => {
    // 101 * 1.2 = 121.2 → 121
    const estimate = estimateDuration([{ id: 'q1', timeLimitSec: 101 }]);
    expect(estimate.estimatedSeconds).toBe(121);
    expect(Number.isInteger(estimate.estimatedSeconds)).toBe(true);
  });
});
