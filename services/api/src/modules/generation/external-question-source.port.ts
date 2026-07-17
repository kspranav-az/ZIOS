import type { QuestionBankItem } from '@zios/shared-types';

/** Injection token for the external question-source port. */
export const EXTERNAL_QUESTION_SOURCE_PORT = Symbol('EXTERNAL_QUESTION_SOURCE_PORT');

/**
 * Port for an external question provider. Phase 05 ships a stub that searches
 * the internal bank; a real partner integration would authenticate per-org and
 * normalize responses into the same `QuestionBankItem` shape.
 */
export interface ExternalQuestionSourcePort {
  search(orgId: string, query: string): Promise<QuestionBankItem[]>;
}
