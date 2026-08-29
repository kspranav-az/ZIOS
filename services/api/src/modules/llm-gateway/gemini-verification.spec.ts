import { describe, expect, it } from 'vitest';
import { Guardrails } from './guardrails';
import { GeminiLlmProvider } from './gemini.provider';
import { LlmGateway } from './llm-gateway.service';
import { MockLlmProvider } from './mock-llm.provider';
import { PromptRegistry } from './prompt-registry';

/**
 * Real Gemini end-to-end verification. Skipped unless explicitly enabled to
 * avoid consuming API credits during normal test runs.
 *
 * To run:
 *   RUN_GEMINI_VERIFICATION=true GEMINI_API_KEY=... pnpm --filter @zios/api test gemini-verification
 */
const runVerification = process.env.RUN_GEMINI_VERIFICATION === 'true';
const describeOrSkip = runVerification ? describe : describe.skip;

describeOrSkip('Gemini verification', () => {
  it('analyzes a JD and returns a structured profile', async () => {
    const gateway = new LlmGateway(new PromptRegistry(), new Guardrails());
    gateway.registerProvider(new MockLlmProvider());
    gateway.registerProvider(new GeminiLlmProvider());

    const output = await gateway.complete<{
      title: string | null;
      seniority: string | null;
      skills: string[];
      responsibilities: string[];
    }>({
      task: 'analyze_jd',
      variables: {
        jdText:
          'Senior Backend Engineer\n\nResponsibilities:\n- Design scalable APIs\n- Mentor engineers\n\nRequired skills:\n- Python, PostgreSQL, Kubernetes',
      },
      policy: { provider: 'gemini' },
    });

    expect(output.provider).toBe('gemini');
    expect(output.parsed.title?.toLowerCase()).toContain('backend');
    expect(output.parsed.skills.length).toBeGreaterThan(0);
    expect(output.cost).toBeGreaterThan(0);
  });

  it('judges a single-answer transcript', async () => {
    const gateway = new LlmGateway(new PromptRegistry(), new Guardrails());
    gateway.registerProvider(new MockLlmProvider());
    gateway.registerProvider(new GeminiLlmProvider());

    const output = await gateway.complete<{
      scores: Array<{ score: number; evidenceSpan: { quoteText: string } }>;
      recommendation: number;
      confidence: number;
    }>({
      task: 'judge_score',
      variables: {
        questions: [
          {
            id: 'q1',
            rubricLines: [{ id: 'r1', text: 'Clarity', weight: 1 }],
          },
        ],
        transcript: [
          {
            id: 't1',
            questionId: 'q1',
            answerText:
              'I led a migration project with a tight timeline and cross-functional stakeholders.',
          },
        ],
      },
      policy: { provider: 'gemini', cache: false },
    });

    expect(output.provider).toBe('gemini');
    expect(output.parsed.scores).toHaveLength(1);
    expect(output.parsed.recommendation).toBeGreaterThanOrEqual(1);
    expect(output.parsed.recommendation).toBeLessThanOrEqual(5);
  });
});
