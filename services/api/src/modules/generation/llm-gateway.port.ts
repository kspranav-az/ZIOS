import type { JdProfile, ProposedQuestion, QuestionType } from '@zios/shared-types';

/** Injection token for the LLM gateway port (real adapter added in Phase 06). */
export const LLM_GATEWAY_PORT = Symbol('LLM_GATEWAY_PORT');

/**
 * Port for JD analysis and question drafting. Phase 05 binds this to a
 * deterministic stub adapter; Phase 06 swaps the adapter without touching
 * feature code (provider independence).
 */
export interface LlmGatewayPort {
  analyzeJd(jdText: string): Promise<JdProfile>;
  draftQuestions(
    profile: JdProfile,
    topic: string,
    type: QuestionType,
    count: number,
  ): Promise<ProposedQuestion[]>;
}
