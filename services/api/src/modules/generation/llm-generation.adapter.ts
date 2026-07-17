import { Injectable } from '@nestjs/common';
import type { JdProfile, ProposedQuestion, QuestionType } from '@zios/shared-types';
import { LlmGateway } from '@/modules/llm-gateway';
import type { LlmGatewayPort } from './llm-gateway.port';

/**
 * Phase 06 adapter that routes JD analysis and question drafting through the
 * central LLM gateway. Feature code (GenerationService) continues to depend on
 * LlmGatewayPort, so this is a same-contract swap.
 */
@Injectable()
export class LlmGenerationAdapter implements LlmGatewayPort {
  constructor(private readonly gateway: LlmGateway) {}

  async analyzeJd(jdText: string): Promise<JdProfile> {
    const output = await this.gateway.complete<JdProfile>({
      task: 'analyze_jd',
      variables: { jdText },
    });
    return output.parsed;
  }

  async draftQuestions(
    profile: JdProfile,
    topic: string,
    type: QuestionType,
    count: number,
  ): Promise<ProposedQuestion[]> {
    const output = await this.gateway.complete<ProposedQuestion[]>({
      task: 'draft_questions',
      variables: { profile, topic, type, count },
    });
    return output.parsed;
  }
}
