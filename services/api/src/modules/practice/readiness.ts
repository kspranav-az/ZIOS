import type { CommunicationMetrics } from '@zios/shared-types';

/**
 * Readiness score (Phase 12, Branch 5) — deterministic, transparent, no table:
 * computed on read over the last N completed + judged practice sessions.
 *
 * READINESS_FORMULA_V1 (all sub-scores 0-100, N = sessions used):
 *   scoreBlend    = mean(overallRecommendation) / 5 * 100
 *   paceScore     = 100 * (sessions with 100 <= paceWpm <= 180) / N
 *   fillerScore   = max(0, 100 - 20 * mean(fillerCount))
 *   structureScore= mean per session: paragraphCount >= 2 ? 100 : 50 * paragraphCount
 *   readiness     = round(0.50*scoreBlend + 0.20*paceScore + 0.15*fillerScore + 0.15*structureScore)
 *
 * The response always carries the formula version and every component so the
 * UI can show the breakdown (transparency is a Blueprint requirement).
 */
export const READINESS_FORMULA_V1 = 'READINESS_FORMULA_V1';
export const READINESS_WINDOW = 5;

/** D11 COGS guardrail (beta): max completed mocks per account per day. */
export const PRACTICE_DAILY_COMPLETION_CAP = 3;

export interface ReadinessSessionInput {
  overallRecommendation: number | null;
  communicationMetrics: CommunicationMetrics | null;
}

export interface ReadinessComponents {
  scoreBlend: number;
  paceScore: number;
  fillerScore: number;
  structureScore: number;
}

export interface ReadinessResult {
  formulaVersion: typeof READINESS_FORMULA_V1;
  readiness: number | null;
  components: ReadinessComponents | null;
  sessionsUsed: number;
}

export function computeReadiness(sessions: ReadinessSessionInput[]): ReadinessResult {
  const judged = sessions.filter(
    (s) => s.overallRecommendation !== null && s.communicationMetrics !== null,
  );
  if (judged.length === 0) {
    return { formulaVersion: READINESS_FORMULA_V1, readiness: null, components: null, sessionsUsed: 0 };
  }

  const scoreBlend =
    (judged.reduce((sum, s) => sum + (s.overallRecommendation ?? 0), 0) / judged.length / 5) * 100;

  const paceInRange = judged.filter((s) => {
    const pace = s.communicationMetrics?.paceWpm ?? 0;
    return pace >= 100 && pace <= 180;
  }).length;
  const paceScore = (paceInRange / judged.length) * 100;

  const meanFillers =
    judged.reduce((sum, s) => sum + (s.communicationMetrics?.fillerCount ?? 0), 0) / judged.length;
  const fillerScore = Math.max(0, 100 - 20 * meanFillers);

  const structureScore =
    (judged.reduce((sum, s) => {
      const paragraphs = s.communicationMetrics?.paragraphCount ?? 0;
      return sum + (paragraphs >= 2 ? 100 : 50 * paragraphs);
    }, 0) /
      judged.length);

  const readiness = Math.round(
    0.5 * scoreBlend + 0.2 * paceScore + 0.15 * fillerScore + 0.15 * structureScore,
  );

  const round1 = (n: number): number => Math.round(n * 10) / 10;
  return {
    formulaVersion: READINESS_FORMULA_V1,
    readiness,
    components: {
      scoreBlend: round1(scoreBlend),
      paceScore: round1(paceScore),
      fillerScore: round1(fillerScore),
      structureScore: round1(structureScore),
    },
    sessionsUsed: judged.length,
  };
}

/** Consecutive days (ending today or yesterday) with at least one completed session. */
export function computeStreak(completedDays: string[]): number {
  const days = [...new Set(completedDays)].sort();
  if (days.length === 0) return 0;
  const dayMs = 86_400_000;
  const dates = days.map((d) => new Date(`${d}T00:00:00Z`).getTime());
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const last = days[days.length - 1] as string;
  // Streak is only "live" if the most recent day is today or yesterday.
  if (last !== today && last !== yesterday) return 0;
  let streak = 1;
  for (let i = dates.length - 2; i >= 0; i -= 1) {
    if ((dates[i + 1] as number) - (dates[i] as number) === dayMs) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}
