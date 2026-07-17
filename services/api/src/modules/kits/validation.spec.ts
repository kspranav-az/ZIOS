import { describe, expect, it } from 'vitest';
import type { Kit, KitQuestion } from '@zios/shared-types';
import { validateKitForPublish, validateQuestionShape, type QuestionShape } from './validation';

function validShape(overrides: Partial<QuestionShape> = {}): QuestionShape {
  return {
    topic: 'Behavioral',
    type: 'open_ended',
    prompt: 'Tell me about a time you handled conflict.',
    options: null,
    difficulty: 'medium',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    followupFixed: null,
    followupDepthCap: null,
    rubricLines: [{ id: 'r1', text: 'Clarity', weight: 1 }],
    ...overrides,
  };
}

function expectError(shape: QuestionShape, fragment: string): void {
  const errors = validateQuestionShape(shape);
  expect(errors.some((error) => error.includes(fragment))).toBe(true);
}

describe('validateQuestionShape', () => {
  it('accepts a valid open-ended question', () => {
    expect(validateQuestionShape(validShape())).toEqual([]);
  });

  it('requires a non-empty topic and prompt', () => {
    expectError(validShape({ topic: '  ' }), 'topic is required');
    expectError(validShape({ prompt: '' }), 'prompt is required');
  });

  it('rejects unknown enums', () => {
    expectError(validShape({ type: 'essay' }), 'type must be one of');
    expectError(validShape({ difficulty: 'brutal' }), 'difficulty must be one of');
    expectError(validShape({ timeLimitType: 'medium' }), 'timeLimitType must be one of');
    expectError(validShape({ followupPolicy: 'sometimes' }), 'followupPolicy must be one of');
  });

  it('validates time limits as positive integers or null', () => {
    expect(validateQuestionShape(validShape({ timeLimitSec: null }))).toEqual([]);
    expectError(validShape({ timeLimitSec: 0 }), 'positive integer');
    expectError(validShape({ timeLimitSec: -30 }), 'positive integer');
    expectError(validShape({ timeLimitSec: 1.5 }), 'positive integer');
  });

  it('requires ≥ 2 well-formed options for MCQ types', () => {
    expectError(validShape({ type: 'mcq_single', options: null }), 'at least 2 options');
    expectError(
      validShape({ type: 'mcq_multi', options: [{ id: 'a', text: 'One' }] }),
      'at least 2 options',
    );
    expectError(
      validShape({
        type: 'mcq_single',
        options: [
          { id: 'a', text: 'One' },
          { id: 'a', text: 'Two' },
        ],
      }),
      'duplicate id',
    );
    expectError(
      validShape({
        type: 'mcq_single',
        options: [
          { id: 'a', text: 'One' },
          { id: 'b', text: '  ' },
        ],
      }),
      'text is required',
    );
    expect(
      validateQuestionShape(
        validShape({
          type: 'mcq_single',
          options: [
            { id: 'a', text: 'One', correct: true },
            { id: 'b', text: 'Two' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('allows at most one correct option on mcq_single', () => {
    expectError(
      validShape({
        type: 'mcq_single',
        options: [
          { id: 'a', text: 'One', correct: true },
          { id: 'b', text: 'Two', correct: true },
        ],
      }),
      'at most one correct',
    );
  });

  it('forbids options on non-MCQ types (rating_scale is a fixed 1–5 scale)', () => {
    expectError(
      validShape({ type: 'rating_scale', options: [{ id: 'a', text: '1' }] as never }),
      'options are only valid for MCQ types',
    );
    expectError(
      validShape({ type: 'open_ended', options: [{ id: 'a', text: '1' }] as never }),
      'options are only valid for MCQ types',
    );
  });

  it('adaptive_ai requires an open_ended type and a depth cap of 1–3 (FR-E2-4)', () => {
    expect(
      validateQuestionShape(validShape({ followupPolicy: 'adaptive_ai', followupDepthCap: 2 })),
    ).toEqual([]);
    expectError(
      validShape({ followupPolicy: 'adaptive_ai', followupDepthCap: null }),
      'followupDepthCap of 1–3',
    );
    expectError(
      validShape({ followupPolicy: 'adaptive_ai', followupDepthCap: 0 }),
      'followupDepthCap of 1–3',
    );
    expectError(
      validShape({ followupPolicy: 'adaptive_ai', followupDepthCap: 4 }),
      'followupDepthCap of 1–3',
    );
    expectError(
      validShape({
        type: 'mcq_single',
        options: [
          { id: 'a', text: 'One' },
          { id: 'b', text: 'Two' },
        ],
        followupPolicy: 'adaptive_ai',
        followupDepthCap: 2,
      }),
      'open_ended questions only',
    );
  });

  it('fixed policy requires at least one non-empty follow-up', () => {
    expect(
      validateQuestionShape(validShape({ followupPolicy: 'fixed', followupFixed: ['Why?'] })),
    ).toEqual([]);
    expectError(
      validShape({ followupPolicy: 'fixed', followupFixed: null }),
      'at least one non-empty followupFixed entry',
    );
    expectError(
      validShape({ followupPolicy: 'fixed', followupFixed: [] }),
      'at least one non-empty followupFixed entry',
    );
    expectError(
      validShape({ followupPolicy: 'fixed', followupFixed: ['  '] }),
      'at least one non-empty followupFixed entry',
    );
  });

  it('validates rubric line structure', () => {
    expectError(validShape({ rubricLines: [{ id: '', text: 'x', weight: 1 }] }), 'id is required');
    expectError(
      validShape({ rubricLines: [{ id: 'r1', text: '', weight: 1 }] }),
      'text is required',
    );
    expectError(
      validShape({ rubricLines: [{ id: 'r1', text: 'x', weight: 0 }] }),
      'positive number',
    );
    expectError(
      validShape({
        rubricLines: [
          { id: 'r1', text: 'a', weight: 0.5 },
          { id: 'r1', text: 'b', weight: 0.5 },
        ],
      }),
      'duplicate id',
    );
  });
});

/* ---- publish gate ---- */

function makeKit(overrides: Partial<Kit> = {}): Kit {
  return {
    id: 'kit-1',
    orgId: 'org-1',
    title: 'Backend Engineer Screen',
    role: 'Backend Engineer',
    level: 'mid',
    status: 'draft',
    settings: {
      mode: 'text',
      language: 'en',
      proctoringLevel: 'none',
      introText: null,
      outroText: null,
      logoUrl: null,
      totalTimeCapSec: 1800,
    },
    jdRef: null,
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<KitQuestion> = {}): KitQuestion {
  return {
    id: 'q1',
    kitId: 'kit-1',
    topic: 'Behavioral',
    position: 'V',
    type: 'open_ended',
    prompt: 'Tell me about a time you handled conflict.',
    options: null,
    difficulty: 'medium',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    followupFixed: null,
    followupDepthCap: null,
    rubricLines: [{ id: 'r1', text: 'Clarity', weight: 1 }],
    source: 'manual',
    sourceRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('validateKitForPublish', () => {
  it('accepts a complete kit', () => {
    expect(validateKitForPublish(makeKit(), [makeQuestion()], 144)).toEqual([]);
  });

  it('requires title, role, and level', () => {
    const errors = validateKitForPublish(
      makeKit({ role: null, level: ' ' }),
      [makeQuestion()],
      144,
    );
    expect(errors.some((e) => e.includes('role is required'))).toBe(true);
    expect(errors.some((e) => e.includes('level is required'))).toBe(true);
  });

  it('requires at least one question', () => {
    const errors = validateKitForPublish(makeKit(), [], 0);
    expect(errors.some((e) => e.includes('at least one question'))).toBe(true);
  });

  it('requires rubric coverage on every question', () => {
    const errors = validateKitForPublish(makeKit(), [makeQuestion({ rubricLines: [] })], 144);
    expect(errors.some((e) => e.includes('at least one rubric line'))).toBe(true);
  });

  it('requires rubric weights summing to 1 within tolerance', () => {
    const bad = makeQuestion({
      rubricLines: [
        { id: 'r1', text: 'a', weight: 0.5 },
        { id: 'r2', text: 'b', weight: 0.3 },
      ],
    });
    const errors = validateKitForPublish(makeKit(), [bad], 144);
    expect(errors.some((e) => e.includes('must sum to 1'))).toBe(true);

    const floatOk = makeQuestion({
      rubricLines: [
        { id: 'r1', text: 'a', weight: 0.4 },
        { id: 'r2', text: 'b', weight: 0.3 },
        { id: 'r3', text: 'c', weight: 0.3 },
      ],
    });
    // 0.4 + 0.3 + 0.3 = 1.0000000000000002 in IEEE754 — inside tolerance.
    expect(validateKitForPublish(makeKit(), [floatOk], 144)).toEqual([]);
  });

  it('re-runs draft shape rules and labels them with the question index', () => {
    const errors = validateKitForPublish(
      makeKit(),
      [makeQuestion(), makeQuestion({ id: 'q2', prompt: '  ' })],
      288,
    );
    expect(errors.some((e) => e.startsWith('question 2') && e.includes('prompt is required'))).toBe(
      true,
    );
  });

  it('rejects when the duration estimate exceeds the kit cap', () => {
    const kit = makeKit();
    kit.settings.totalTimeCapSec = 100;
    const errors = validateKitForPublish(kit, [makeQuestion()], 144);
    expect(errors.some((e) => e.includes('exceeds the kit time cap'))).toBe(true);
  });
});
