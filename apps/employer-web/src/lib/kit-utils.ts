import type {
  KitQuestion,
  McqOption,
  QuestionDifficulty,
  QuestionType,
  RubricLine,
} from '@zios/shared-types';

/**
 * Pure kit-builder helpers: client-side mirrors of the api's question-shape
 * rules (services/api/src/modules/kits/validation.ts) for inline form
 * feedback, plus small shared utilities. No React, no fetch — unit-tested.
 */

export const QUESTION_TYPES: readonly QuestionType[] = [
  'open_ended',
  'mcq_single',
  'mcq_multi',
  'rating_scale',
];
export const QUESTION_DIFFICULTIES: readonly QuestionDifficulty[] = ['easy', 'medium', 'hard'];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  open_ended: 'Open-ended',
  mcq_single: 'MCQ — single answer',
  mcq_multi: 'MCQ — multiple answers',
  rating_scale: 'Rating scale (1–5)',
};

export const DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const SOURCE_LABELS: Record<KitQuestion['source'], string> = {
  manual: 'Manual',
  bank: 'From bank',
  jd_generated: 'JD-generated',
  external_api: 'External API',
};

/** Default per-question seconds the duration estimator assumes (api duration.ts). */
export const DEFAULT_QUESTION_SECONDS = 120;

/** Publish tolerance for rubric weight sums (api validation.ts). */
export const RUBRIC_WEIGHT_TOLERANCE = 0.01;

/** Stable ids for rubric lines / MCQ options (frozen into version snapshots). */
export function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function isMcq(type: QuestionType): type is 'mcq_single' | 'mcq_multi' {
  return type === 'mcq_single' || type === 'mcq_multi';
}

/** Sum of rubric weights, float-noise trimmed for display. */
export function rubricWeightSum(lines: RubricLine[]): number {
  return lines.reduce((total, line) => total + (Number.isFinite(line.weight) ? line.weight : 0), 0);
}

/** True when the weights satisfy the publish rule (sum to 1 ± 0.01). */
export function rubricWeightsValid(lines: RubricLine[]): boolean {
  return lines.length > 0 && Math.abs(rubricWeightSum(lines) - 1) <= RUBRIC_WEIGHT_TOLERANCE;
}

/**
 * Auto-normalize affordance: scale every weight so the sum is exactly 1,
 * rounded to 3 decimals with the rounding remainder absorbed by the largest
 * line. Empty / all-zero input is returned unchanged (nothing to scale).
 */
export function normalizeRubricWeights(lines: RubricLine[]): RubricLine[] {
  const sum = rubricWeightSum(lines);
  if (lines.length === 0 || sum <= 0) return lines;
  const scaled = lines.map((line) => ({
    ...line,
    weight: Math.max(0.001, Math.round((line.weight / sum) * 1000) / 1000),
  }));
  const scaledSum = rubricWeightSum(scaled);
  const drift = Math.round((1 - scaledSum) * 1000) / 1000;
  if (drift !== 0) {
    let largest = 0;
    scaled.forEach((line, index) => {
      if (line.weight > scaled[largest]!.weight) largest = index;
    });
    scaled[largest] = {
      ...scaled[largest]!,
      weight: Math.round((scaled[largest]!.weight + drift) * 1000) / 1000,
    };
  }
  return scaled;
}

/** The draft shape the editor validates before writes (mirrors api QuestionShape). */
export interface QuestionDraftShape {
  topic: string;
  type: QuestionType;
  prompt: string;
  options: McqOption[] | null;
  difficulty: QuestionDifficulty;
  timeLimitSec: number | null;
  timeLimitType: 'soft' | 'hard';
  mandatory: boolean;
  followupPolicy: 'none' | 'fixed' | 'adaptive_ai';
  followupFixed: string[] | null;
  followupDepthCap: number | null;
  rubricLines: RubricLine[];
}

/**
 * Client-side mirror of the api's validateQuestionShape — same messages so
 * inline feedback matches the 400/422 the server would return.
 */
export function validateQuestionDraft(shape: QuestionDraftShape): string[] {
  const errors: string[] = [];

  if (shape.topic.trim().length === 0) errors.push('topic is required');
  if (shape.prompt.trim().length === 0) errors.push('prompt is required');

  if (
    shape.timeLimitSec !== null &&
    (!Number.isInteger(shape.timeLimitSec) || shape.timeLimitSec <= 0)
  ) {
    errors.push('timeLimitSec must be a positive integer or null');
  }

  if (isMcq(shape.type)) {
    const options = shape.options;
    if (!Array.isArray(options) || options.length < 2) {
      errors.push(`${shape.type} requires at least 2 options`);
    } else {
      const ids = new Set<string>();
      options.forEach((option, index) => {
        if (option.id.trim().length === 0) errors.push(`option ${index + 1}: id is required`);
        else if (ids.has(option.id))
          errors.push(`option ${index + 1}: duplicate id '${option.id}'`);
        else ids.add(option.id);
        if (option.text.trim().length === 0) errors.push(`option ${index + 1}: text is required`);
      });
      if (shape.type === 'mcq_single' && options.filter((o) => o.correct === true).length > 1) {
        errors.push('mcq_single allows at most one correct option');
      }
    }
  } else if (shape.options !== null) {
    errors.push(`options are only valid for MCQ types, not ${shape.type}`);
  }

  if (shape.followupPolicy === 'adaptive_ai') {
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
      shape.followupFixed.some((line) => line.trim().length === 0)
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

  const ids = new Set<string>();
  shape.rubricLines.forEach((line, index) => {
    if (line.id.trim().length === 0) errors.push(`rubric line ${index + 1}: id is required`);
    else if (ids.has(line.id)) errors.push(`rubric line ${index + 1}: duplicate id '${line.id}'`);
    else ids.add(line.id);
    if (line.text.trim().length === 0) errors.push(`rubric line ${index + 1}: text is required`);
    if (!(line.weight > 0))
      errors.push(`rubric line ${index + 1}: weight must be a positive number`);
  });

  return errors;
}

/**
 * Full-order serialization for POST …/questions/reorder: every id exactly
 * once, in display order. Returns null when the input is not a valid
 * permutation of itself (defensive — the server 400s a mismatched set).
 */
export function serializeQuestionOrder(
  questions: ReadonlyArray<Pick<KitQuestion, 'id'>>,
): string[] {
  const ids = questions.map((question) => question.id);
  return new Set(ids).size === ids.length ? ids : [];
}

/** "24 min" / "1 h 30 min" duration formatting for the estimate bar. */
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Parses the leading `question N ("…")` label the api puts on per-question
 * publish-validation details, so the 422 panel can anchor to the offending
 * card. Returns the 1-based question index, or null for kit-level details.
 */
export function questionIndexFromPublishDetail(detail: string): number | null {
  const match = detail.match(/^question (\d+) \(/);
  if (!match) return null;
  const index = Number.parseInt(match[1]!, 10);
  return Number.isInteger(index) && index > 0 ? index : null;
}
