import type { KitQuestion, SessionTranscript } from '@zios/shared-types';

/**
 * A scoring unit aggregates all transcript rows that belong to one question
 * (the initial question plus any follow-ups). This keeps rubric-line scoring
 * aligned with the kit definition while still preserving per-row evidence.
 */
export interface ScoringUnit {
  questionId: string;
  question: KitQuestion;
  /** Rows in display order. */
  rows: SessionTranscript[];
  /** Concatenated answer text with paragraph separators for metric calculations. */
  combinedAnswer: string;
}

/**
 * Maps a flat transcript to scoring units keyed by question id.
 * Follow-up rows share the same question_id as their parent and are merged.
 */
export function buildScoringUnits(
  transcript: SessionTranscript[],
  questions: KitQuestion[],
): ScoringUnit[] {
  const questionById = new Map<string, KitQuestion>();
  for (const question of questions) {
    questionById.set(question.id, question);
  }

  const rowsByQuestion = new Map<string, SessionTranscript[]>();
  for (const row of transcript) {
    if (row.answerText === null) continue;
    const list = rowsByQuestion.get(row.questionId) ?? [];
    list.push(row);
    rowsByQuestion.set(row.questionId, list);
  }

  const units: ScoringUnit[] = [];
  // Preserve question display order from the kit snapshot.
  for (const question of questions) {
    const rows = rowsByQuestion.get(question.id) ?? [];
    if (rows.length === 0) continue;
    const combinedAnswer = rows.map((row) => row.answerText as string).join('\n\n');
    units.push({ questionId: question.id, question, rows, combinedAnswer });
  }
  return units;
}
