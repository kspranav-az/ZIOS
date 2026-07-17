import type {
  InterviewSession,
  KitSnapshot,
  SessionTranscript,
  SessionTurnResponse,
} from '@zios/shared-types';

export interface InterviewerContext {
  session: InterviewSession;
  snapshot: KitSnapshot;
  transcript: SessionTranscript[];
}

/**
 * InterviewerAi port (ADR-0002): the engine that decides what the candidate
 * sees/hears next. Phase 03 ships a deterministic stub; Phase 06 swaps the
 * adapter for an LLM-backed conductor with zero call-site changes.
 */
export interface InterviewerAi {
  nextTurn(ctx: InterviewerContext): SessionTurnResponse;
}

export const INTERVIEWER_AI = Symbol('INTERVIEWER_AI');
