import { Injectable } from '@nestjs/common';
import type { InterviewerAi, InterviewerContext } from './interviewer-ai.port';

/**
 * Deterministic stub conductor for Phase 03 text-mode interviews.
 *
 * - Follows the kit question order exactly.
 * - Asks one question at a time.
 * - Honors `fixed` follow-ups at depth 1.
 * - Treats `adaptive_ai` follow-ups as no follow-up (stubbed for Phase 06).
 * - Wraps up with the kit outro text when all questions are answered.
 */
@Injectable()
export class StubConductorAdapter implements InterviewerAi {
  nextTurn(ctx: InterviewerContext): import('@zios/shared-types').SessionTurnResponse {
    const { snapshot, transcript } = ctx;
    const questions = snapshot.questions;

    // Build a map of questionId -> answer count (questions + followups asked).
    const askedCounts = new Map<string, number>();
    for (const row of transcript) {
      askedCounts.set(row.questionId, (askedCounts.get(row.questionId) ?? 0) + 1);
    }

    // Find the first question that is not fully answered yet.
    for (const question of questions) {
      const asked = askedCounts.get(question.id) ?? 0;
      const fixedFollowups =
        question.followupPolicy === 'fixed' ? (question.followupFixed ?? []) : [];
      const totalSlots = 1 + fixedFollowups.length; // main + fixed followups
      const answered = transcript.filter(
        (t) => t.questionId === question.id && t.answerText !== null,
      ).length;

      if (answered < totalSlots) {
        if (asked === 0) {
          return { type: 'question', text: question.prompt, questionId: question.id };
        }
        // Ask the next fixed followup if available.
        const followupIndex = asked - 1;
        if (followupIndex < fixedFollowups.length) {
          return {
            type: 'followup',
            text: fixedFollowups[followupIndex] as string,
            questionId: question.id,
          };
        }
        // Should not happen because answered < totalSlots, but fall through to next question.
      }
    }

    // All questions answered -> wrap up.
    const outro = snapshot.kit.settings.outroText;
    return {
      type: 'wrapup',
      text:
        outro ??
        "Thank you for completing the interview. We'll share the next steps with the hiring team.",
      questionId: null,
    };
  }
}
