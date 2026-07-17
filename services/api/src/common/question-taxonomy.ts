/**
 * Platform-wide question taxonomy (PRD §6.2). Lives in the shared kernel so
 * feature modules (kits, question-bank, later sessions/evaluation) can share
 * the canonical value lists without importing each other.
 */
import type {
  FollowupPolicy,
  QuestionDifficulty,
  QuestionType,
  TimeLimitType,
} from '@zios/shared-types';

export const QUESTION_TYPES: readonly QuestionType[] = [
  'open_ended',
  'mcq_single',
  'mcq_multi',
  'rating_scale',
];
export const QUESTION_DIFFICULTIES: readonly QuestionDifficulty[] = ['easy', 'medium', 'hard'];
export const TIME_LIMIT_TYPES: readonly TimeLimitType[] = ['soft', 'hard'];
export const FOLLOWUP_POLICIES: readonly FollowupPolicy[] = ['none', 'fixed', 'adaptive_ai'];
