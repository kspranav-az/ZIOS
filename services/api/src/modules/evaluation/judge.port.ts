import type {
  CommunicationMetrics,
  EvaluationReport,
  KitQuestion,
  SessionTranscript,
} from '@zios/shared-types';

/**
 * Evidence span produced by a judge: a slice of a transcript row cited to
 * justify a score. Coordinates are character offsets into answer_text.
 */
export interface JudgeEvidenceSpan {
  transcriptId: string;
  questionId: string;
  start: number;
  end: number;
  quoteText: string;
}

/**
 * Per-rubric-line score produced by a judge.
 */
export interface JudgeScore {
  questionId: string;
  criterionId: string;
  criterionText: string;
  score: number;
  weight: number;
  evidenceSpan: JudgeEvidenceSpan;
}

/**
 * Complete judge output for a single session.
 */
export interface JudgeResult {
  scores: JudgeScore[];
  metrics: CommunicationMetrics;
  recommendation: number;
  confidence: number;
}

/**
 * Port for the evaluation judge. The first argument is a partial report
 * containing session/kit context; it is intentionally passed before the
 * report row is persisted so the judge can be invoked after the pending
 * report header exists. The judge must not assume report.id is present.
 */
export interface JudgePort {
  evaluate(
    report: Pick<EvaluationReport, 'orgId' | 'sessionId' | 'kitVersionId'>,
    transcript: SessionTranscript[],
    questions: KitQuestion[],
  ): Promise<JudgeResult>;
}

export const JUDGE_PORT = Symbol('JUDGE_PORT');
