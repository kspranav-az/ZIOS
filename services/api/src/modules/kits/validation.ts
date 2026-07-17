/**
 * Question-shape and publish validation (FR-E2-2…E2-4, §6.2). Pure functions
 * returning human-readable error strings; services turn a non-empty list into
 * 400 VALIDATION_ERROR (draft writes) or 422 PUBLISH_VALIDATION_FAILED.
 */
import type {
  FollowupPolicy,
  Kit,
  KitQuestion,
  McqOption,
  QuestionDifficulty,
  QuestionType,
  RubricLine,
  TimeLimitType,
} from '@zios/shared-types';
import {
  FOLLOWUP_POLICIES,
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  TIME_LIMIT_TYPES,
} from '@/common/question-taxonomy';

/** Weights must sum to 1 within this tolerance at publish (float-safe). */
export const RUBRIC_WEIGHT_TOLERANCE = 0.01;

/** The fully-merged candidate state a draft write is validated against. */
export interface QuestionShape {
  topic: string;
  type: string;
  prompt: string;
  options: McqOption[] | null;
  difficulty: string;
  timeLimitSec: number | null;
  timeLimitType: string;
  mandatory: boolean;
  followupPolicy: string;
  followupFixed: string[] | null;
  followupDepthCap: number | null;
  rubricLines: RubricLine[];
}

function isMcq(type: string): boolean {
  return type === 'mcq_single' || type === 'mcq_multi';
}

/** Draft-time rules: everything the DB and the session runner rely on. */
export function validateQuestionShape(shape: QuestionShape): string[] {
  const errors: string[] = [];

  if (typeof shape.topic !== 'string' || shape.topic.trim().length === 0) {
    errors.push('topic is required');
  }
  if (!QUESTION_TYPES.includes(shape.type as QuestionType)) {
    errors.push(`type must be one of ${QUESTION_TYPES.join(', ')}`);
  }
  if (typeof shape.prompt !== 'string' || shape.prompt.trim().length === 0) {
    errors.push('prompt is required');
  }
  if (!QUESTION_DIFFICULTIES.includes(shape.difficulty as QuestionDifficulty)) {
    errors.push(`difficulty must be one of ${QUESTION_DIFFICULTIES.join(', ')}`);
  }
  if (!TIME_LIMIT_TYPES.includes(shape.timeLimitType as TimeLimitType)) {
    errors.push(`timeLimitType must be one of ${TIME_LIMIT_TYPES.join(', ')}`);
  }
  if (
    shape.timeLimitSec !== null &&
    (!Number.isInteger(shape.timeLimitSec) || shape.timeLimitSec <= 0)
  ) {
    errors.push('timeLimitSec must be a positive integer or null');
  }
  if (typeof shape.mandatory !== 'boolean') {
    errors.push('mandatory must be a boolean');
  }

  if (isMcq(shape.type)) {
    const options = shape.options;
    if (!Array.isArray(options) || options.length < 2) {
      errors.push(`${shape.type} requires at least 2 options`);
    } else {
      const ids = new Set<string>();
      options.forEach((option, index) => {
        if (typeof option?.id !== 'string' || option.id.trim().length === 0) {
          errors.push(`option ${index + 1}: id is required`);
        } else if (ids.has(option.id)) {
          errors.push(`option ${index + 1}: duplicate id '${option.id}'`);
        } else {
          ids.add(option.id);
        }
        if (typeof option?.text !== 'string' || option.text.trim().length === 0) {
          errors.push(`option ${index + 1}: text is required`);
        }
      });
      if (
        shape.type === 'mcq_single' &&
        options.filter((option) => option.correct === true).length > 1
      ) {
        errors.push('mcq_single allows at most one correct option');
      }
    }
  } else if (shape.options !== null) {
    // rating_scale is a fixed 1–5 scale and open_ended has no choices (§6.2).
    errors.push(`options are only valid for MCQ types, not ${shape.type}`);
  }

  if (!FOLLOWUP_POLICIES.includes(shape.followupPolicy as FollowupPolicy)) {
    errors.push(`followupPolicy must be one of ${FOLLOWUP_POLICIES.join(', ')}`);
  } else if (shape.followupPolicy === 'adaptive_ai') {
    if (shape.type !== 'open_ended') {
      errors.push('adaptive_ai follow-ups apply to open_ended questions only (§6.2)');
    }
    if (
      shape.followupDepthCap === null ||
      !Number.isInteger(shape.followupDepthCap) ||
      shape.followupDepthCap < 1 ||
      shape.followupDepthCap > 3
    ) {
      errors.push('adaptive_ai requires a followupDepthCap of 1–3 (FR-E2-4)');
    }
  } else if (shape.followupPolicy === 'fixed') {
    if (
      !Array.isArray(shape.followupFixed) ||
      shape.followupFixed.length === 0 ||
      shape.followupFixed.some((line) => typeof line !== 'string' || line.trim().length === 0)
    ) {
      errors.push('fixed follow-up policy requires at least one non-empty followupFixed entry');
    }
  }
  if (
    shape.followupDepthCap !== null &&
    (!Number.isInteger(shape.followupDepthCap) ||
      shape.followupDepthCap < 1 ||
      shape.followupDepthCap > 3)
  ) {
    errors.push('followupDepthCap must be an integer between 1 and 3');
  }

  if (!Array.isArray(shape.rubricLines)) {
    errors.push('rubricLines must be an array');
  } else {
    const ids = new Set<string>();
    shape.rubricLines.forEach((line, index) => {
      if (typeof line?.id !== 'string' || line.id.trim().length === 0) {
        errors.push(`rubric line ${index + 1}: id is required`);
      } else if (ids.has(line.id)) {
        errors.push(`rubric line ${index + 1}: duplicate id '${line.id}'`);
      } else {
        ids.add(line.id);
      }
      if (typeof line?.text !== 'string' || line.text.trim().length === 0) {
        errors.push(`rubric line ${index + 1}: text is required`);
      }
      if (typeof line?.weight !== 'number' || !(line.weight > 0)) {
        errors.push(`rubric line ${index + 1}: weight must be a positive number`);
      }
    });
  }

  return errors;
}

function questionLabel(index: number, question: KitQuestion): string {
  const snippet = question.prompt.trim().slice(0, 48);
  return `question ${index + 1} ("${snippet}${question.prompt.trim().length > 48 ? '…' : ''}")`;
}

/**
 * Publish gate (FR-E2-5): everything the draft rules guarantee, plus the
 * fields only a publishable kit needs (role/level, rubric coverage with
 * weights summing to 1) and the server-side duration cap check.
 */
export function validateKitForPublish(
  kit: Kit,
  questions: KitQuestion[],
  estimatedSeconds: number,
): string[] {
  const errors: string[] = [];

  if (kit.title.trim().length === 0) {
    errors.push('kit title is required');
  }
  if (!kit.role || kit.role.trim().length === 0) {
    errors.push('kit role is required before publishing');
  }
  if (!kit.level || kit.level.trim().length === 0) {
    errors.push('kit level is required before publishing');
  }
  if (questions.length === 0) {
    errors.push('kit needs at least one question');
  }

  questions.forEach((question, index) => {
    const label = questionLabel(index, question);
    for (const error of validateQuestionShape(question)) {
      errors.push(`${label}: ${error}`);
    }
    if (question.rubricLines.length === 0) {
      errors.push(`${label}: at least one rubric line is required to publish`);
    } else {
      const sum = question.rubricLines.reduce((total, line) => total + line.weight, 0);
      if (Math.abs(sum - 1) > RUBRIC_WEIGHT_TOLERANCE) {
        errors.push(`${label}: rubric weights must sum to 1 (got ${sum.toFixed(3)})`);
      }
    }
  });

  if (estimatedSeconds > kit.settings.totalTimeCapSec) {
    errors.push(
      `estimated duration ${estimatedSeconds}s exceeds the kit time cap of ${kit.settings.totalTimeCapSec}s — shorten questions or raise the cap`,
    );
  }

  return errors;
}
