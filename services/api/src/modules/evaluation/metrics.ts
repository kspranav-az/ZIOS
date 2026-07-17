import type { CommunicationMetrics, SessionTranscript } from '@zios/shared-types';

const FILLER_RE = /\b(um|uh|like)\b/gi;

function countWords(text: string): number {
  const matches = text.trim().match(/\b\w+\b/g);
  return matches?.length ?? 0;
}

function countSentences(text: string): number {
  const splits = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  return Math.max(1, splits.length);
}

function countParagraphs(text: string): number {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return Math.max(1, paragraphs.length);
}

/**
 * Returns the duration in minutes for a single answered transcript row.
 * Falls back to 1 minute so pace is never infinite for instantaneous answers.
 */
export function rowDurationMinutes(row: SessionTranscript): number {
  const answeredAt = row.answeredAt ? new Date(row.answeredAt).getTime() : 0;
  const createdAt = new Date(row.createdAt).getTime();
  const ms = answeredAt > createdAt ? answeredAt - createdAt : 0;
  return Math.max(1, ms / 1000 / 60);
}

/**
 * Observable delivery metrics only: pace, fillers, structure. No emotion,
 * personality, or face inference (Blueprint invariant §2).
 */
export function computeCommunicationMetrics(transcript: SessionTranscript[]): CommunicationMetrics {
  const answered = transcript.filter((row) => row.answerText !== null);
  const totalWords = answered.reduce((sum, row) => sum + countWords(row.answerText as string), 0);
  const totalMinutes = answered.reduce((sum, row) => sum + rowDurationMinutes(row), 0);

  const allAnswerText = answered.map((row) => row.answerText as string).join('\n\n');
  const fillerCount = (allAnswerText.match(FILLER_RE) ?? []).length;
  const paragraphCount = countParagraphs(allAnswerText || ' ');

  const totalSentences = answered.reduce(
    (sum, row) => sum + countSentences(row.answerText as string),
    0,
  );
  const avgSentenceLength = totalWords > 0 ? totalWords / totalSentences : 0;

  return {
    paceWpm: totalMinutes > 0 ? Math.round((totalWords / totalMinutes) * 10) / 10 : 0,
    fillerCount,
    paragraphCount,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
  };
}
