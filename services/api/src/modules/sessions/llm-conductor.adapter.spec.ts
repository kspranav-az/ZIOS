import { describe, expect, it } from 'vitest';
import { LlmGateway, PromptRegistry, Guardrails, MockLlmProvider } from '@/modules/llm-gateway';
import { LlmConductorAdapter } from './llm-conductor.adapter';

describe('LlmConductorAdapter', () => {
  function makeAdapter() {
    const registry = new PromptRegistry();
    const guardrails = new Guardrails();
    const gateway = new LlmGateway(registry, guardrails);
    gateway.registerProvider(new MockLlmProvider());
    return new LlmConductorAdapter(gateway);
  }

  it('asks the first kit question', async () => {
    const adapter = makeAdapter();
    const turn = await adapter.nextTurn({
      session: { id: 's1' } as import('@zios/shared-types').InterviewSession,
      snapshot: {
        schemaVersion: 1,
        kit: {
          id: 'k1',
          title: 'T',
          role: null,
          level: null,
          settings: {} as import('@zios/shared-types').KitSettings,
          jdRef: null,
        },
        questions: [
          {
            id: 'q1',
            prompt: 'What is AI?',
            followupPolicy: 'none',
            followupFixed: null,
            followupDepthCap: null,
          },
        ] as import('@zios/shared-types').KitQuestion[],
        durationEstimateSec: 60,
      },
      transcript: [],
    });
    expect(turn).toEqual({ type: 'question', text: 'What is AI?', questionId: 'q1' });
  });
});
