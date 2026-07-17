import { describe, expect, it } from 'vitest';
import type { KitQuestion } from '@zios/shared-types';
import {
  normalizeRubricWeights,
  questionIndexFromPublishDetail,
  rubricWeightSum,
  rubricWeightsValid,
  serializeQuestionOrder,
  validateQuestionDraft,
  type QuestionDraftShape,
} from '../lib/kit-utils';

/** Question-shape validators + rubric math + reorder serialization (FR-E2-1…E2-4). */

function baseShape(overrides: Partial<QuestionDraftShape> = {}): QuestionDraftShape {
  return {
    topic: 'System design',
    type: 'open_ended',
    prompt: 'Design a URL shortener.',
    options: null,
    difficulty: 'medium',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    followupFixed: null,
    followupDepthCap: null,
    rubricLines: [{ id: 'r1', text: 'Correctness', weight: 1 }],
    ...overrides,
  };
}

describe('validateQuestionDraft', () => {
  it('accepts a well-formed open-ended question', () => {
    expect(validateQuestionDraft(baseShape())).toEqual([]);
  });

  it('requires a topic and a prompt', () => {
    const errors = validateQuestionDraft(baseShape({ topic: '  ', prompt: '' }));
    expect(errors).toContain('topic is required');
    expect(errors).toContain('prompt is required');
  });

  it('requires at least 2 options for MCQ types', () => {
    const errors = validateQuestionDraft(
      baseShape({ type: 'mcq_single', options: [{ id: 'o1', text: 'Only one' }] }),
    );
    expect(errors).toContain('mcq_single requires at least 2 options');
  });

  it('rejects options on non-MCQ types', () => {
    const errors = validateQuestionDraft(
      baseShape({
        type: 'rating_scale',
        options: [
          { id: 'o1', text: 'A' },
          { id: 'o2', text: 'B' },
        ],
      }),
    );
    expect(errors.some((e) => e.includes('options are only valid for MCQ types')).toString()).toBe(
      'true',
    );
  });

  it('allows at most one correct option for mcq_single but many for mcq_multi', () => {
    const twoCorrect = [
      { id: 'o1', text: 'A', correct: true },
      { id: 'o2', text: 'B', correct: true },
    ];
    expect(validateQuestionDraft(baseShape({ type: 'mcq_single', options: twoCorrect }))).toContain(
      'mcq_single allows at most one correct option',
    );
    expect(validateQuestionDraft(baseShape({ type: 'mcq_multi', options: twoCorrect }))).toEqual(
      [],
    );
  });

  it('rejects duplicate option ids', () => {
    const errors = validateQuestionDraft(
      baseShape({
        type: 'mcq_multi',
        options: [
          { id: 'dup', text: 'A' },
          { id: 'dup', text: 'B' },
        ],
      }),
    );
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  /* ---- follow-up policy conditionals (FR-E2-4) ---- */

  it('adaptive_ai is valid only on open_ended with a depth cap of 1–3', () => {
    expect(
      validateQuestionDraft(baseShape({ followupPolicy: 'adaptive_ai', followupDepthCap: 2 })),
    ).toEqual([]);

    expect(
      validateQuestionDraft(
        baseShape({
          type: 'mcq_single',
          options: [
            { id: 'o1', text: 'A' },
            { id: 'o2', text: 'B' },
          ],
          followupPolicy: 'adaptive_ai',
          followupDepthCap: 2,
        }),
      ),
    ).toContain('adaptive_ai follow-ups apply to open_ended questions only (§6.2)');

    expect(
      validateQuestionDraft(baseShape({ followupPolicy: 'adaptive_ai', followupDepthCap: null })),
    ).toContain('adaptive_ai requires a followupDepthCap of 1–3 (FR-E2-4)');

    expect(
      validateQuestionDraft(baseShape({ followupPolicy: 'adaptive_ai', followupDepthCap: 4 })),
    ).toContain('adaptive_ai requires a followupDepthCap of 1–3 (FR-E2-4)');
  });

  it('fixed policy requires at least one non-empty follow-up line', () => {
    expect(
      validateQuestionDraft(baseShape({ followupPolicy: 'fixed', followupFixed: ['Why?'] })),
    ).toEqual([]);
    expect(
      validateQuestionDraft(baseShape({ followupPolicy: 'fixed', followupFixed: [] })),
    ).toContain('fixed follow-up policy requires at least one non-empty followupFixed entry');
    expect(
      validateQuestionDraft(baseShape({ followupPolicy: 'fixed', followupFixed: ['  '] })),
    ).toContain('fixed follow-up policy requires at least one non-empty followupFixed entry');
  });

  it('validates rubric line text and weight positivity', () => {
    const errors = validateQuestionDraft(
      baseShape({ rubricLines: [{ id: 'r1', text: '', weight: 0 }] }),
    );
    expect(errors).toContain('rubric line 1: text is required');
    expect(errors).toContain('rubric line 1: weight must be a positive number');
  });

  it('requires positive integer time limits when set', () => {
    expect(validateQuestionDraft(baseShape({ timeLimitSec: 0 }))).toContain(
      'timeLimitSec must be a positive integer or null',
    );
    expect(validateQuestionDraft(baseShape({ timeLimitSec: null }))).toEqual([]);
  });
});

describe('rubric weight math', () => {
  it('sums weights and checks the publish tolerance (1 ± 0.01)', () => {
    const lines = [
      { id: 'a', text: 'A', weight: 0.6 },
      { id: 'b', text: 'B', weight: 0.4 },
    ];
    expect(rubricWeightSum(lines)).toBeCloseTo(1);
    expect(rubricWeightsValid(lines)).toBe(true);
    expect(rubricWeightsValid([{ id: 'a', text: 'A', weight: 0.5 }])).toBe(false);
    expect(rubricWeightsValid([])).toBe(false);
  });

  it('auto-normalizes weights to sum to exactly 1', () => {
    const normalized = normalizeRubricWeights([
      { id: 'a', text: 'A', weight: 1 },
      { id: 'b', text: 'B', weight: 1 },
      { id: 'c', text: 'C', weight: 1 },
    ]);
    expect(rubricWeightSum(normalized)).toBeCloseTo(1, 6);
    expect(normalized.every((line) => line.weight > 0)).toBe(true);
  });

  it('normalize leaves empty input untouched', () => {
    expect(normalizeRubricWeights([])).toEqual([]);
  });
});

describe('serializeQuestionOrder', () => {
  it('returns every id exactly once in display order', () => {
    const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }] as Array<Pick<KitQuestion, 'id'>>;
    expect(serializeQuestionOrder(questions)).toEqual(['q1', 'q2', 'q3']);
  });
});

describe('questionIndexFromPublishDetail', () => {
  it('parses the server’s question-N label for anchoring', () => {
    expect(
      questionIndexFromPublishDetail('question 3 ("Why…"): rubric weights must sum to 1'),
    ).toBe(3);
    expect(questionIndexFromPublishDetail('kit role is required before publishing')).toBeNull();
  });
});
