import { describe, expect, it } from 'vitest';
import type { InterviewSession, KitSnapshot, SessionTranscript } from '@zios/shared-types';
import { LlmGenerationAdapter, StubLlmAdapter } from '@/modules/generation';
import { JudgeEnsembleAdapter, StubJudgeAdapter } from '@/modules/evaluation';
import { LlmConductorAdapter, StubConductorAdapter } from '@/modules/sessions';
import { Guardrails } from './guardrails';
import { LlmGateway } from './llm-gateway.service';
import { MockLlmProvider } from './mock-llm.provider';
import { PromptRegistry } from './prompt-registry';

function makeGateway() {
  const gateway = new LlmGateway(new PromptRegistry(), new Guardrails());
  gateway.registerProvider(new MockLlmProvider());
  return gateway;
}

const SAMPLE_JD = `Senior Backend Engineer

Responsibilities:
- Design APIs
- Mentor engineers

Required skills:
- Python, PostgreSQL`;

function makeSnapshot(): KitSnapshot {
  return {
    schemaVersion: 1,
    kit: {
      id: 'k1',
      title: 'T',
      role: null,
      level: null,
      settings: { outroText: 'Done.' } as import('@zios/shared-types').KitSettings,
      jdRef: null,
    },
    questions: [
      {
        id: 'q1',
        prompt: 'What is AI?',
        type: 'open_ended',
        followupPolicy: 'fixed',
        followupFixed: ['Why?'],
        followupDepthCap: 2,
        rubricLines: [{ id: 'r1', text: 'Clarity', weight: 1 }],
      } as import('@zios/shared-types').KitQuestion,
    ],
    durationEstimateSec: 60,
  };
}

describe('Adapter contract parity (stub vs gateway-backed)', () => {
  it('generation: stub and gateway-backed adapters produce the same profile shape', async () => {
    const stub = new StubLlmAdapter();
    const gateway = makeGateway();
    const backed = new LlmGenerationAdapter(gateway);

    const stubProfile = await stub.analyzeJd(SAMPLE_JD);
    const backedProfile = await backed.analyzeJd(SAMPLE_JD);

    expect(backedProfile.title).toBe(stubProfile.title);
    expect(backedProfile.seniority).toBe(stubProfile.seniority);
    expect(backedProfile.skills).toEqual(stubProfile.skills);
    expect(backedProfile.responsibilities).toEqual(stubProfile.responsibilities);
  });

  it('generation: drafted questions keep topic, type and source across adapters', async () => {
    const stub = new StubLlmAdapter();
    const gateway = makeGateway();
    const backed = new LlmGenerationAdapter(gateway);

    const profile = await stub.analyzeJd(SAMPLE_JD);
    const stubQs = await stub.draftQuestions(profile, 'Python', 'open_ended', 1);
    const backedQs = await backed.draftQuestions(profile, 'Python', 'open_ended', 1);

    expect(backedQs).toHaveLength(stubQs.length);
    expect(backedQs[0]).toMatchObject({
      topic: 'Python',
      type: 'open_ended',
      source: 'jd_generated',
    });
  });

  it('conductor: stub and gateway-backed adapters ask the same first question', async () => {
    const stub = new StubConductorAdapter();
    const gateway = makeGateway();
    const backed = new LlmConductorAdapter(gateway);
    const ctx = {
      session: { id: 's1' } as InterviewSession,
      snapshot: makeSnapshot(),
      transcript: [],
    };
    const stubTurn = await stub.nextTurn(ctx);
    const backedTurn = await backed.nextTurn(ctx);
    expect(backedTurn).toEqual(stubTurn);
  });

  it('judge: gateway-backed ensemble returns the same score shape as the stub', async () => {
    const stub = new StubJudgeAdapter();
    const gateway = makeGateway();
    const backed = new JudgeEnsembleAdapter(gateway);
    const transcript: SessionTranscript[] = [
      {
        id: 't1',
        sessionId: 's1',
        questionId: 'q1',
        questionPrompt: 'What is AI?',
        answerText: 'AI is artificial intelligence used to solve problems.',
        position: 0,
        evidenceSpan: [],
        createdAt: new Date().toISOString(),
        answeredAt: new Date().toISOString(),
      },
    ];
    const questions = makeSnapshot().questions;
    const stubResult = await stub.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'v1' },
      transcript,
      questions,
    );
    const backedResult = await backed.evaluate(
      { orgId: 'o1', sessionId: 's1', kitVersionId: 'v1' },
      transcript,
      questions,
    );

    expect(backedResult.scores).toHaveLength(stubResult.scores.length);
    expect(backedResult.scores[0]).toMatchObject({
      questionId: 'q1',
      criterionId: 'r1',
      evidenceSpan: expect.objectContaining({ transcriptId: 't1' }),
    });
    expect(backedResult.metrics).toBeDefined();
    expect(backedResult.recommendation).toBeGreaterThanOrEqual(1);
    expect(backedResult.recommendation).toBeLessThanOrEqual(5);
  });
});
