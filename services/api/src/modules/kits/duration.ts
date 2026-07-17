/**
 * Duration estimator (kit time cap, FR-E2-3): per-question time limits
 * (default 120s when unset) plus a fixed 20% overhead for transitions,
 * reading time, and follow-ups. The estimate is what publish compares against
 * the kit's totalTimeCapSec.
 */

export const DEFAULT_QUESTION_SECONDS = 120;
export const DURATION_OVERHEAD_FACTOR = 1.2;

export interface DurationQuestionInput {
  id: string;
  timeLimitSec: number | null;
}

export interface DurationEstimate {
  questionCount: number;
  baseSeconds: number;
  estimatedSeconds: number;
  perQuestion: Array<{ questionId: string; seconds: number }>;
}

export function estimateDuration(questions: DurationQuestionInput[]): DurationEstimate {
  const perQuestion = questions.map((question) => ({
    questionId: question.id,
    seconds: question.timeLimitSec ?? DEFAULT_QUESTION_SECONDS,
  }));
  const baseSeconds = perQuestion.reduce((sum, question) => sum + question.seconds, 0);
  return {
    questionCount: questions.length,
    baseSeconds,
    estimatedSeconds: Math.round(baseSeconds * DURATION_OVERHEAD_FACTOR),
    perQuestion,
  };
}
