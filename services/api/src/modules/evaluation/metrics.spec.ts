import { describe, expect, it } from 'vitest';
import type { SessionTranscript } from '@zios/shared-types';
import { computeCommunicationMetrics, rowDurationMinutes } from './metrics';

function transcript(rows: Partial<SessionTranscript>[]): SessionTranscript[] {
  return rows.map((row, index) => ({
    id: `t-${index}`,
    sessionId: 's1',
    questionId: `q-${index}`,
    questionPrompt: `prompt-${index}`,
    answerText: row.answerText ?? null,
    answerData: row.answerData ?? null,
    position: index,
    evidenceSpan: [],
    createdAt: row.createdAt ?? '2024-01-01T00:00:00.000Z',
    answeredAt: row.answeredAt ?? null,
  }));
}

describe('metrics', () => {
  it('computes pace in words per minute', () => {
    const rows = transcript([
      {
        answerText: 'one two three four five',
        createdAt: '2024-01-01T00:00:00.000Z',
        answeredAt: '2024-01-01T00:01:00.000Z',
      },
    ]);
    const metrics = computeCommunicationMetrics(rows);
    expect(metrics.paceWpm).toBe(5);
  });

  it('falls back to one minute when no duration is recorded', () => {
    const rows = transcript([{ answerText: 'one two three four five' }]);
    const metrics = computeCommunicationMetrics(rows);
    expect(metrics.paceWpm).toBe(5);
  });

  it('counts filler words across answers', () => {
    const rows = transcript([
      { answerText: 'Um, I think um we should uh proceed.' },
      { answerText: 'Like, this is like important.' },
    ]);
    const metrics = computeCommunicationMetrics(rows);
    expect(metrics.fillerCount).toBe(5);
  });

  it('counts paragraphs separated by blank lines', () => {
    const rows = transcript([
      { answerText: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.' },
    ]);
    const metrics = computeCommunicationMetrics(rows);
    expect(metrics.paragraphCount).toBe(3);
  });

  it('computes average sentence length', () => {
    const rows = transcript([{ answerText: 'Short sentence. This one has more words in it.' }]);
    const metrics = computeCommunicationMetrics(rows);
    expect(metrics.avgSentenceLength).toBeGreaterThan(0);
  });

  it('returns zero metrics for an empty transcript', () => {
    const metrics = computeCommunicationMetrics([]);
    expect(metrics.paceWpm).toBe(0);
    expect(metrics.fillerCount).toBe(0);
    expect(metrics.paragraphCount).toBe(1);
    expect(metrics.avgSentenceLength).toBe(0);
  });
});

describe('rowDurationMinutes', () => {
  it('returns one minute minimum', () => {
    const row = transcript([
      {
        answerText: 'answer',
        createdAt: '2024-01-01T00:00:00.000Z',
        answeredAt: '2024-01-01T00:00:00.100Z',
      },
    ])[0]!;
    expect(rowDurationMinutes(row)).toBe(1);
  });

  it('computes real duration in minutes', () => {
    const row = transcript([
      {
        answerText: 'answer',
        createdAt: '2024-01-01T00:00:00.000Z',
        answeredAt: '2024-01-01T00:02:30.000Z',
      },
    ])[0]!;
    expect(rowDurationMinutes(row)).toBe(2.5);
  });
});
