import { Injectable } from '@nestjs/common';
import type { SessionTurnResponse } from '@zios/shared-types';
import { LlmGateway } from '@/modules/llm-gateway';
import type { InterviewerAi, InterviewerContext } from './interviewer-ai.port';

/**
 * Phase 06 conductor adapter backed by the central LLM gateway. Returns the
 * same `SessionTurnResponse` contract as the stub, but uses the gateway so
 * routing, fallback, guardrails and cost attribution are centralized.
 */
@Injectable()
export class LlmConductorAdapter implements InterviewerAi {
  constructor(private readonly gateway: LlmGateway) {}

  async nextTurn(ctx: InterviewerContext): Promise<SessionTurnResponse> {
    const { snapshot, transcript } = ctx;
    const followupDepthCap = Math.max(0, ...snapshot.questions.map((q) => q.followupDepthCap ?? 0));
    const output = await this.gateway.complete<SessionTurnResponse>({
      task: 'conductor_next_turn',
      variables: {
        questions: snapshot.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          followupPolicy: q.followupPolicy,
          followupFixed: q.followupFixed,
        })),
        transcript,
        followupDepthCap,
      },
      policy: { tier: 'quality', cache: false },
    });
    return output.parsed;
  }
}
