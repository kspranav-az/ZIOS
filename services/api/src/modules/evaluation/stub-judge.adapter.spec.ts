import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { KitQuestion, SessionTranscript } from '@zios/shared-types';
import { StubJudgeAdapter } from './stub-judge.adapter';

function makeQuestion(id: string, rubricIds: string[]): KitQuestion {
  return {
    id,
    kitId: 'k1',
    topic: 'Test',
    position: '0',
    type: 'open_ended',
    prompt: `prompt-${id}`,
    options: null,
    difficulty: 'medium',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    followupFixed: null,
    followupDepthCap: null,
    rubricLines: rubricIds.map((rid) => ({
      id: rid,
      text: `Rubric ${rid}`,
      weight: 1 / rubricIds.length,
    })),
    source: 'manual',
    sourceRef: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function transcript(rows: Partial<SessionTranscript>[]): SessionTranscript[] {
  return rows.map((row, index) => ({
    id: `t-${index}`,
    sessionId: 's1',
    questionId: row.questionId ?? 'q1',
    questionPrompt: 'prompt',
    answerText: row.answerText ?? null,
    answerData: row.answerData ?? null,
    position: index,
    evidenceSpan: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    answeredAt: row.answeredAt ?? '2024-01-01T00:01:00.000Z',
  }));
}

describe('StubJudgeAdapter', () => {
  const judge = new StubJudgeAdapter();

  it('produces one score per rubric line per answered question', async () => {
    const q1 = makeQuestion('q1', [randomUUID(), randomUUID()]);
    const q2 = makeQuestion('q2', [randomUUID()]);
    const rows = transcript([
      {
        questionId: 'q1',
        answerText: 'A moderately detailed answer with enough length to score three.',
      },
      { questionId: 'q2', answerText: 'Short.' },
    ]);

    const result = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      rows,
      [q1, q2],
    );

    expect(result.scores).toHaveLength(3);
    expect(result.scores.every((s) => s.evidenceSpan.quoteText.length > 0)).toBe(true);
  });

  it('scores short answers lower than detailed answers', async () => {
    const criterionId = randomUUID();
    const question = makeQuestion('q1', [criterionId]);
    const short = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([{ questionId: 'q1', answerText: 'Short.' }]),
      [question],
    );
    const long = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([
        {
          questionId: 'q1',
          answerText:
            'This is a very long and detailed answer that covers many aspects of the problem, provides context, explains the reasoning, and concludes with a clear summary of the main points.',
        },
      ]),
      [question],
    );
    expect(long.scores[0]!.score).toBeGreaterThan(short.scores[0]!.score);
  });

  it('penalizes filler-spam even when answers are long', async () => {
    const criterionId = randomUUID();
    const question = makeQuestion('q1', [criterionId]);
    const spam = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([
        {
          questionId: 'q1',
          answerText:
            'um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um um',
        },
      ]),
      [question],
    );
    expect(spam.scores[0]!.score).toBeLessThan(5);
  });

  it('maps evidence spans to the full answer text', async () => {
    const criterionId = randomUUID();
    const question = makeQuestion('q1', [criterionId]);
    const answer = 'A'.repeat(200);
    const result = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([{ questionId: 'q1', answerText: answer }]),
      [question],
    );
    expect(result.scores[0]!.evidenceSpan.end).toBe(answer.length);
    expect(result.scores[0]!.evidenceSpan.quoteText).toBe(answer);
  });

  it('scores rating_scale questions deterministically from the rating value', async () => {
    const criterionId = randomUUID();
    const question: KitQuestion = { ...makeQuestion('q1', [criterionId]), type: 'rating_scale' };
    const result = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([
        {
          questionId: 'q1',
          answerText: 'Rating: 4/5',
          answerData: { type: 'rating_scale', rating: 4 },
        },
      ]),
      [question],
    );
    expect(result.scores[0]!.score).toBe(4);
    expect(result.scores[0]!.evidenceSpan.quoteText).toBe('Rating: 4/5');
  });

  it('scores mcq_single as full marks when the correct option is selected', async () => {
    const criterionId = randomUUID();
    const optionId = randomUUID();
    const question: KitQuestion = {
      ...makeQuestion('q1', [criterionId]),
      type: 'mcq_single',
      options: [
        { id: optionId, text: 'Correct', correct: true },
        { id: randomUUID(), text: 'Wrong', correct: false },
      ],
    };
    const result = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([
        {
          questionId: 'q1',
          answerText: 'Correct',
          answerData: { type: 'mcq_single', selectedOptionIds: [optionId] },
        },
      ]),
      [question],
    );
    expect(result.scores[0]!.score).toBe(5);
  });

  it('scores mcq_multi proportionally when only some correct options are selected', async () => {
    const criterionId = randomUUID();
    const correctA = randomUUID();
    const correctB = randomUUID();
    const question: KitQuestion = {
      ...makeQuestion('q1', [criterionId]),
      type: 'mcq_multi',
      options: [
        { id: correctA, text: 'A', correct: true },
        { id: correctB, text: 'B', correct: true },
        { id: randomUUID(), text: 'C', correct: false },
      ],
    };
    const result = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([
        {
          questionId: 'q1',
          answerText: 'A',
          answerData: { type: 'mcq_multi', selectedOptionIds: [correctA] },
        },
      ]),
      [question],
    );
    expect(result.scores[0]!.score).toBeGreaterThanOrEqual(3);
    expect(result.scores[0]!.score).toBeLessThan(5);
  });

  it('returns a recommendation between 1 and 5', async () => {
    const question = makeQuestion('q1', [randomUUID()]);
    const result = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([{ questionId: 'q1', answerText: 'A reasonable answer with enough content.' }]),
      [question],
    );
    expect(result.recommendation).toBeGreaterThanOrEqual(1);
    expect(result.recommendation).toBeLessThanOrEqual(5);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.confidence).toBeLessThanOrEqual(0.99);
  });

  it('includes communication metrics', async () => {
    const question = makeQuestion('q1', [randomUUID()]);
    const result = await judge.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'kv1' },
      transcript([
        {
          questionId: 'q1',
          answerText: 'Um, I have like three paragraphs.\n\nSecond one.\n\nThird one.',
        },
      ]),
      [question],
    );
    expect(result.metrics.fillerCount).toBe(2);
    expect(result.metrics.paragraphCount).toBe(3);
  });
});
