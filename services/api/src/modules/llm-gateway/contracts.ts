/**
 * Internal contracts for the LLM gateway (Phase 06).
 *
 * The gateway is the single internal API for all AI calls. Adapters for
 * generation, the interview conductor and the judge ensemble sit behind the
 * existing feature ports and route through the gateway so routing, fallback,
 * budgets, guardrails, caching and cost attribution happen in one place.
 */

export interface LlmRequestPolicy {
  /** Explicit provider override. */
  provider?: string;
  /** Quality/latency/cost tier used when no provider is requested. */
  tier?: 'quality' | 'balanced' | 'cheap';
  /** Per-request budget ceiling in the configured cost unit (e.g. USD). */
  budgetCeiling?: number;
  /** Whether fallback is allowed when the primary provider fails. */
  fallback?: boolean;
  /** Whether response caching is allowed for this request. */
  cache?: boolean;
  /** Provider-specific model override (e.g. gemini-1.5-pro). */
  model?: string;
  /** Provider-specific generation parameter. */
  temperature?: number;
  /** Provider-specific top-p parameter. */
  topP?: number;
  /** Provider-specific max output tokens parameter. */
  maxOutputTokens?: number;
}

export interface LlmCompletionInput<
  TVariables extends Record<string, unknown> = Record<string, unknown>,
> {
  task: string;
  variables: TVariables;
  policy?: LlmRequestPolicy;
  orgId?: string;
  sessionId?: string;
}

export interface LlmCompletionOutput<T = unknown> {
  task: string;
  promptVersion: string;
  provider: string;
  modelRoute: string;
  parsed: T;
  cost: number;
  latencyMs: number;
  cached: boolean;
  /** Request/response payload with candidate PII redacted for the journal. */
  redactedRequest: unknown;
  /** Raw provider response before parsing (used for debugging). */
  raw: unknown;
}

export interface LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly costPer1kInput: number;
  readonly costPer1kOutput: number;
  /**
   * True for deterministic stub providers whose output is fabricated locally
   * (no external model call). The gateway never selects a fabricated provider
   * implicitly while a real provider is registered — fabricated output must be
   * opt-in (mock-only mode) or explicitly requested via policy.provider.
   */
  readonly fabricated?: boolean;
  complete(input: {
    task: string;
    promptText: string;
    variables: Record<string, unknown>;
    policy?: LlmRequestPolicy;
  }): Promise<{
    text: string;
    tokensIn: number;
    tokensOut: number;
    model?: string;
  }>;
}

export interface PromptDefinition {
  id: string;
  version: string;
  task: string;
  template: string;
  variablesSchema: string[];
  /** Required top-level keys in the parsed JSON response. */
  outputSchema: string[];
  defaultPolicy: LlmRequestPolicy;
  guardrailProfile?: GuardrailProfile;
  /** Per-provider policy/model overrides declared in the prompt file. */
  providerOverrides?: Record<string, Partial<LlmRequestPolicy> & Record<string, unknown>>;
}

export type GuardrailProfile = 'candidate_input' | 'jd_input' | 'internal_only';

export interface GuardrailResult {
  blocked: boolean;
  reason?: string;
}

/** Evidence span referenced by mock judge fixtures. */
export interface JudgeEvidenceSpan {
  transcriptId: string | null;
  questionId: string;
  start: number;
  end: number;
  quoteText: string;
}

export interface LlmJournalEntry {
  id: string;
  occurredAt: string;
  task: string;
  promptVersion: string;
  provider: string;
  modelRoute: string;
  orgId?: string;
  sessionId?: string;
  cost: number;
  latencyMs: number;
  cached: boolean;
  redactedRequest: unknown;
  redactedResponse: unknown;
}
