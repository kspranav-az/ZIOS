import type { ResumeJdMatchSuggestion } from '@zios/shared-types';

/**
 * Honesty guardrail for resume-jd-match (Phase 12, D10): an LLM rewrite must
 * never invent metrics. Any number that appears in the improved bullet but
 * NOT in the original verbatim bullet is flagged — the UI shows the flag
 * instead of presenting the claim as the candidate's own.
 *
 * Pure function: unit-testable, no I/O.
 */
export function flagSuggestionHonesty(
  suggestion: Pick<ResumeJdMatchSuggestion, 'original' | 'improved'>,
): string[] {
  const flags: string[] = [];
  const originalNumbers = new Set(
    (suggestion.original.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(',', '')),
  );
  const improvedNumbers = suggestion.improved.match(/\d+(?:[.,]\d+)*/g) ?? [];
  for (const number of improvedNumbers) {
    const normalised = number.replace(',', '');
    if (!originalNumbers.has(normalised)) {
      flags.push(`fabricated-metric:${normalised}`);
    }
  }
  return flags;
}

/** Validate a whole match result, attaching flags to each suggestion. */
export function validateMatchHonesty(
  suggestions: Array<Pick<ResumeJdMatchSuggestion, 'original' | 'improved'>>,
): ResumeJdMatchSuggestion[] {
  return suggestions.map((suggestion) => ({
    ...suggestion,
    honestyFlags: flagSuggestionHonesty(suggestion),
  }));
}
