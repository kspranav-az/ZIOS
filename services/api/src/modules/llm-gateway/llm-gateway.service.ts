import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiException } from '@/common/errors';
import type {
  LlmCompletionInput,
  LlmCompletionOutput,
  LlmJournalEntry,
  LlmProvider,
  LlmRequestPolicy,
} from './contracts';
import { Guardrails } from './guardrails';
import { PromptRegistry } from './prompt-registry';

interface ProviderState {
  failures: number;
  lastFailureAt: number;
  openUntil: number;
}

interface CachedEntry {
  output: LlmCompletionOutput<unknown>;
  cachedAt: number;
}

function hashVariables(variables: Record<string, unknown>): string {
  // Deterministic JSON hash is sufficient for in-memory caching in mock mode.
  const normalized = JSON.stringify(variables, Object.keys(variables).sort());
  let h = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    h = (h << 5) - h + normalized.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    // Heuristic: redact long free-text answers and JDs to avoid leaking PII
    // into the journal while keeping short identifiers.
    if (value.length > 120) {
      return `<redacted:${value.length}chars>`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

@Injectable()
export class LlmGateway {
  private readonly logger = new Logger(LlmGateway.name);
  private readonly providers = new Map<string, LlmProvider>();
  private readonly state = new Map<string, ProviderState>();
  private readonly cache = new Map<string, CachedEntry>();
  private readonly journal: LlmJournalEntry[] = [];

  // Configurable thresholds; can be moved to env later.
  private readonly circuitFailureThreshold = 3;
  private readonly circuitOpenMs = 30_000;
  private readonly cacheTtlMs = 60_000;

  constructor(
    private readonly registry: PromptRegistry,
    private readonly guardrails: Guardrails,
  ) {}

  registerProvider(provider: LlmProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Single internal API for all AI completions.
   */
  async complete<T = unknown>(input: LlmCompletionInput): Promise<LlmCompletionOutput<T>> {
    const { task, variables, policy = {}, orgId, sessionId } = input;
    const { promptText, definition } = this.registry.render(task, variables);
    const promptVersion = `${definition.id}@${definition.version}`;

    const screen = this.guardrails.screenInput(promptText, definition.guardrailProfile, variables);
    if (screen.blocked) {
      throw new ApiException(400, 'GUARDRAIL_BLOCKED', screen.reason ?? 'guardrail blocked');
    }

    const basePolicy: LlmRequestPolicy = {
      ...definition.defaultPolicy,
      ...policy,
    };

    const cacheKey = this.cacheKey(task, promptVersion, variables);
    if (basePolicy.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
        return { ...(cached.output as LlmCompletionOutput<T>), cached: true, cost: 0 };
      }
    }

    const providers = this.selectProviders(basePolicy);
    if (providers.length === 0) {
      throw new ApiException(503, 'LLM_NO_PROVIDER', 'no LLM provider available for policy');
    }

    const startedAt = Date.now();
    let lastError: Error | undefined;

    for (const provider of providers) {
      if (this.isCircuitOpen(provider.name)) {
        this.logger.warn(`circuit open for provider ${provider.name}; trying fallback`);
        continue;
      }
      try {
        const providerOverride = definition.providerOverrides?.[provider.name] ?? {};
        const mergedPolicy: LlmRequestPolicy = { ...basePolicy, ...providerOverride };
        const raw = await provider.complete({ task, promptText, variables, policy: mergedPolicy });
        const parsed = this.parseResponse<T>(raw.text, definition.outputSchema);
        const latencyMs = Date.now() - startedAt;
        const cost = this.calculateCost(provider, raw.tokensIn, raw.tokensOut);

        const output: LlmCompletionOutput<T> = {
          task,
          promptVersion,
          provider: provider.name,
          modelRoute: raw.model ?? provider.defaultModel,
          parsed,
          cost,
          latencyMs,
          cached: false,
          redactedRequest: redact({ task, variables, policy: mergedPolicy }),
          raw,
        };

        this.recordSuccess(provider.name);
        this.journal.push({
          id: randomUUID(),
          occurredAt: new Date().toISOString(),
          task,
          promptVersion,
          provider: provider.name,
          modelRoute: output.modelRoute,
          orgId,
          sessionId,
          cost,
          latencyMs,
          cached: false,
          redactedRequest: output.redactedRequest,
          redactedResponse: redact(raw),
        });

        if (mergedPolicy.cache) {
          this.cache.set(cacheKey, {
            output: output as LlmCompletionOutput<unknown>,
            cachedAt: Date.now(),
          });
        }

        return output;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.recordFailure(provider.name);
        this.logger.warn(`provider ${provider.name} failed for task ${task}: ${lastError.message}`);
      }
    }

    const reason = lastError?.message ?? 'all providers failed';
    throw new ApiException(503, 'LLM_UNAVAILABLE', reason);
  }

  /**
   * Exposes the PII-redacted request/response journal. In production this
   * would be backed by durable storage and used for cost/audit dashboards.
   */
  getJournal(): readonly LlmJournalEntry[] {
    return this.journal;
  }

  private selectProviders(policy: LlmRequestPolicy): LlmProvider[] {
    const all = Array.from(this.providers.values()).sort(
      (a, b) => a.costPer1kOutput - b.costPer1kOutput,
    );

    // Never implicitly select a fabricated (deterministic stub) provider while
    // a real provider is registered: fabricated output must only be served
    // when it is the only option (mock mode) or explicitly named via
    // policy.provider. This is what keeps LLM_MODE=gemini honest — a gemini
    // failure must surface as an error, not as silently fabricated output.
    const hasRealProvider = all.some((p) => !p.fabricated);
    const eligible = hasRealProvider ? all.filter((p) => !p.fabricated) : all;

    const tier = policy.tier ?? 'balanced';
    let ordered = eligible;
    if (tier === 'quality') {
      ordered = eligible.slice().reverse();
    } else if (tier === 'cheap') {
      ordered = eligible;
    } else {
      // balanced: quality first unless a budget ceiling forces cheap.
      ordered = eligible.slice().reverse();
    }

    const budgetCeiling = policy.budgetCeiling;
    if (budgetCeiling !== undefined) {
      ordered = ordered.filter((p) => this.estimateCost(p) <= budgetCeiling);
    }

    if (policy.provider) {
      const explicit = this.providers.get(policy.provider);
      if (!explicit) return [];
      if (policy.fallback === false) return [explicit];
      // Primary first, then the rest.
      return [explicit, ...ordered.filter((p) => p.name !== explicit.name)];
    }

    return ordered;
  }

  private estimateCost(provider: LlmProvider): number {
    // Assume a typical 1k in / 500 out call.
    return provider.costPer1kInput + provider.costPer1kOutput * 0.5;
  }

  private calculateCost(provider: LlmProvider, tokensIn: number, tokensOut: number): number {
    return (
      (tokensIn / 1000) * provider.costPer1kInput + (tokensOut / 1000) * provider.costPer1kOutput
    );
  }

  private parseResponse<T>(text: string, requiredKeys: string[]): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiException(502, 'LLM_INVALID_JSON', 'provider returned non-JSON output');
    }
    const validation = this.guardrails.validateOutputShape(parsed, requiredKeys);
    if (validation.blocked) {
      throw new ApiException(
        502,
        'LLM_OUTPUT_VALIDATION',
        validation.reason ?? 'output validation failed',
      );
    }
    return parsed as T;
  }

  private isCircuitOpen(name: string): boolean {
    const s = this.state.get(name);
    if (!s) return false;
    return Date.now() < s.openUntil;
  }

  private recordSuccess(name: string): void {
    const s = this.state.get(name);
    if (s) {
      s.failures = 0;
    }
  }

  private recordFailure(name: string): void {
    const now = Date.now();
    const s = this.state.get(name) ?? { failures: 0, lastFailureAt: now, openUntil: 0 };
    s.failures += 1;
    s.lastFailureAt = now;
    if (s.failures >= this.circuitFailureThreshold) {
      s.openUntil = now + this.circuitOpenMs;
    }
    this.state.set(name, s);
  }

  private cacheKey(
    task: string,
    promptVersion: string,
    variables: Record<string, unknown>,
  ): string {
    return `${task}:${promptVersion}:${hashVariables(variables)}`;
  }
}
