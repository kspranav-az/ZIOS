import { describe, expect, it } from 'vitest';
import type { ProposedQuestion } from '@zios/shared-types';
import {
  estimateTotalDuration,
  findLowestPriorityQuestionIndex,
  formatDuration,
  groupQuestionsByTopic,
} from './generation-utils';

function makeQuestion(
  topic: string,
  prompt: string,
  timeLimitSec: number | null,
): ProposedQuestion {
  return {
    topic,
    prompt,
    type: 'open_ended',
    options: null,
    difficulty: 'medium',
    timeLimitSec,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    followupFixed: null,
    followupDepthCap: null,
    rubricLines: [],
    source: 'jd_generated',
    sourceRef: null,
  };
}

describe('formatDuration', () => {
  it('rounds up to the nearest minute', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(121)).toBe('3 min');
    expect(formatDuration(1800)).toBe('30 min');
  });
});

describe('groupQuestionsByTopic', () => {
  it('preserves topic order and groups questions', () => {
    const questions = [
      makeQuestion('Backend', 'Q1', 120),
      makeQuestion('Frontend', 'Q2', 120),
      makeQuestion('Backend', 'Q3', 120),
      makeQuestion('DevOps', 'Q4', 120),
    ];
    const grouped = groupQuestionsByTopic(questions, ['Backend', 'Frontend', 'DevOps']);
    expect(Object.keys(grouped)).toEqual(['Backend', 'Frontend', 'DevOps']);
    expect(grouped.Backend!.map((q) => q.prompt)).toEqual(['Q1', 'Q3']);
    expect(grouped.Frontend!.map((q) => q.prompt)).toEqual(['Q2']);
    expect(grouped.DevOps!.map((q) => q.prompt)).toEqual(['Q4']);
  });

  it('appends unknown topics at the end', () => {
    const questions = [makeQuestion('Unknown', 'Q1', 120)];
    const grouped = groupQuestionsByTopic(questions, ['Known']);
    expect(Object.keys(grouped)).toEqual(['Unknown']);
  });
});

describe('findLowestPriorityQuestionIndex', () => {
  it('returns null for an empty list', () => {
    expect(findLowestPriorityQuestionIndex([])).toBeNull();
  });

  it('returns the last index for non-empty lists', () => {
    expect(findLowestPriorityQuestionIndex([makeQuestion('A', 'Q1', 120)])).toBe(0);
    expect(
      findLowestPriorityQuestionIndex([
        makeQuestion('A', 'Q1', 120),
        makeQuestion('B', 'Q2', 120),
        makeQuestion('C', 'Q3', 120),
      ]),
    ).toBe(2);
  });
});

describe('estimateTotalDuration', () => {
  it('sums limits and applies 1.2x overhead', () => {
    const questions = [
      makeQuestion('A', 'Q1', 120),
      makeQuestion('A', 'Q2', 60),
      makeQuestion('A', 'Q3', null),
    ];
    const result = estimateTotalDuration(questions);
    expect(result.baseSeconds).toBe(300);
    expect(result.estimatedSeconds).toBe(360);
  });
});
