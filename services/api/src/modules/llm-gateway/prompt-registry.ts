import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/errors';
import type { LlmRequestPolicy, PromptDefinition } from './contracts';

const DEFAULT_POLICY: LlmRequestPolicy = { tier: 'balanced', fallback: true, cache: true };

function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value, null, 2);
  });
}

/**
 * In-memory registry of versioned prompts. Prompts are versioned artifacts:
 * every production completion is stamped `prompt@version` and unversioned
 * prompts cannot be deployed.
 */
@Injectable()
export class PromptRegistry {
  private readonly prompts = new Map<string, PromptDefinition>();

  constructor() {
    this.register({
      id: 'analyze-jd',
      version: '1.0.0',
      task: 'analyze_jd',
      template: `Extract a structured role profile from the job description below.

Return valid JSON with exactly these keys:
- title (string or null)
- seniority (string or null: junior, mid, senior, lead, principal)
- skills (array of strings)
- niceToHaveSkills (array of strings)
- responsibilities (array of strings)
- tools (array of strings)
- languages (array of strings)

Job description:
{{jdText}}`,
      variablesSchema: ['jdText'],
      outputSchema: [
        'title',
        'seniority',
        'skills',
        'niceToHaveSkills',
        'responsibilities',
        'tools',
        'languages',
      ],
      defaultPolicy: { ...DEFAULT_POLICY },
      guardrailProfile: 'jd_input',
    });

    this.register({
      id: 'draft-questions',
      version: '1.0.0',
      task: 'draft_questions',
      template: `Draft {{count}} interview question(s) for a {{seniority}} {{title}} role.
Topic: {{topic}}
Question type: {{type}}

Return a JSON array where each object has:
- topic (string)
- type (one of: open_ended, mcq_single, mcq_multi, rating_scale)
- prompt (string)
- options (array of {id, text, correct} for MCQ; null otherwise)
- difficulty (one of: easy, medium, hard)
- timeLimitSec (number)
- timeLimitType (string "soft")
- mandatory (boolean)
- followupPolicy (one of: none, fixed, adaptive_ai)
- followupFixed (array of strings or null)
- followupDepthCap (number or null)
- rubricLines (array of {id, text, weight})
- source (string "jd_generated")
- sourceRef (null)

Profile: {{profile}}`,
      variablesSchema: ['profile', 'topic', 'type', 'count'],
      outputSchema: [],
      defaultPolicy: { ...DEFAULT_POLICY },
      guardrailProfile: 'internal_only',
    });

    this.register({
      id: 'conductor-next-turn',
      version: '1.0.0',
      task: 'conductor_next_turn',
      template: `You are an adaptive technical interviewer. Decide the next thing to say to the candidate.

Kit questions: {{questions}}
Transcript so far: {{transcript}}

Return valid JSON with exactly these keys:
- type (one of: question, followup, wrapup)
- text (string)
- questionId (string or null)

Depth cap for adaptive follow-ups is {{followupDepthCap}}. Do not exceed it.`,
      variablesSchema: ['questions', 'transcript', 'followupDepthCap'],
      outputSchema: ['type', 'text', 'questionId'],
      defaultPolicy: { tier: 'quality', fallback: true, cache: false },
      guardrailProfile: 'candidate_input',
    });

    this.register({
      id: 'judge-score',
      version: '1.0.0',
      task: 'judge_score',
      template: `You are an evaluation judge. Score the candidate's answers against the rubric.

Questions: {{questions}}
Transcript: {{transcript}}

Return valid JSON with exactly these keys:
- scores (array of {questionId, criterionId, criterionText, score, weight, evidenceSpan: {transcriptId, questionId, start, end, quoteText}})
- metrics (object with paceWpm, fillerCount, paragraphCount, avgSentenceLength)
- recommendation (number 1-5)
- confidence (number 0-1)`,
      variablesSchema: ['questions', 'transcript'],
      outputSchema: ['scores', 'metrics', 'recommendation', 'confidence'],
      defaultPolicy: { tier: 'quality', fallback: true, cache: false },
      guardrailProfile: 'internal_only',
    });

    this.register({
      id: 'judge-adjudicate',
      version: '1.0.0',
      task: 'judge_adjudicate',
      template: `Two judges disagreed on scores. Produce a final adjudicated result.

Judge A result: {{judgeA}}
Judge B result: {{judgeB}}

Return valid JSON with exactly these keys:
- scores (array of {questionId, criterionId, criterionText, score, weight, evidenceSpan: {transcriptId, questionId, start, end, quoteText}})
- metrics (object with paceWpm, fillerCount, paragraphCount, avgSentenceLength)
- recommendation (number 1-5)
- confidence (number 0-1)
- rationale (string)`,
      variablesSchema: ['judgeA', 'judgeB'],
      outputSchema: ['scores', 'metrics', 'recommendation', 'confidence', 'rationale'],
      defaultPolicy: { tier: 'quality', fallback: false, cache: false },
      guardrailProfile: 'internal_only',
    });
  }

  private register(prompt: PromptDefinition): void {
    this.prompts.set(prompt.task, prompt);
  }

  get(task: string): PromptDefinition {
    const prompt = this.prompts.get(task);
    if (!prompt) {
      throw new ApiException(400, 'LLM_UNKNOWN_TASK', `no prompt registered for task ${task}`);
    }
    return prompt;
  }

  list(): PromptDefinition[] {
    return Array.from(this.prompts.values());
  }

  render(
    task: string,
    variables: Record<string, unknown>,
  ): { promptText: string; definition: PromptDefinition } {
    const definition = this.get(task);
    for (const key of definition.variablesSchema) {
      if (!(key in variables)) {
        throw new ApiException(
          400,
          'LLM_MISSING_VARIABLE',
          `prompt ${definition.id}@${definition.version} requires variable ${key}`,
        );
      }
    }
    return { promptText: renderTemplate(definition.template, variables), definition };
  }

  stamp(task: string): string {
    const definition = this.get(task);
    return `${definition.id}@${definition.version}`;
  }
}
