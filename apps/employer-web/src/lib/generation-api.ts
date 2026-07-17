import type {
  AnalyzeJdBody,
  AnalyzeJdResponse,
  GenerationProposal,
  ProposeKitBody,
  ProposeKitResponse,
  ProposalEdit,
  PublishProposalBody,
  PublishProposalResponse,
  QuestionType,
  RegenerateQuestionBody,
} from '@zios/shared-types';
import { apiFetch } from './api';

/**
 * Typed calls for the JD-based kit generation endpoints (PRD E3).
 */
export const generationApi = {
  get: (generationId: string) => apiFetch<ProposeKitResponse>(`/generation/${generationId}`),

  analyze: (jdText: string) =>
    apiFetch<AnalyzeJdResponse>('/generation/analyze', {
      method: 'POST',
      json: { jdText } satisfies AnalyzeJdBody,
    }),

  propose: (jdText: string) =>
    apiFetch<ProposeKitResponse>('/generation/propose', {
      method: 'POST',
      json: { jdText } satisfies ProposeKitBody,
    }),

  regenerate: (
    generationId: string,
    index: number,
    constraints?: { topic?: string; type?: QuestionType },
  ) =>
    apiFetch<ProposeKitResponse>(`/generation/${generationId}/regenerate`, {
      method: 'POST',
      json: { index, constraints } satisfies RegenerateQuestionBody,
    }),

  publish: (generationId: string, proposal: GenerationProposal, edits?: ProposalEdit[]) =>
    apiFetch<PublishProposalResponse>(`/generation/${generationId}/publish`, {
      method: 'POST',
      json: { proposal, edits } satisfies PublishProposalBody,
    }),
};
