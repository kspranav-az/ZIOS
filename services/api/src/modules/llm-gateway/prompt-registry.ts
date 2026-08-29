import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

function resolvePromptsDir(): string {
  const candidates = [
    // Local dev / test / production when the working directory is the api package root.
    path.join(process.cwd(), 'prompts'),
    // Built output fallback: dist/modules/llm-gateway -> ... -> prompts.
    path.join(__dirname, '..', '..', '..', 'prompts'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  throw new Error(
    `Prompts directory not found. Tried: ${candidates.join(', ')}. Ensure prompts/ exists at the api package root.`,
  );
}

function loadPromptFiles(): PromptDefinition[] {
  const promptsDir = resolvePromptsDir();
  const prompts: PromptDefinition[] = [];

  for (const taskDirName of readdirSync(promptsDir, { withFileTypes: true })) {
    if (!taskDirName.isDirectory()) continue;
    const taskDir = path.join(promptsDir, taskDirName.name);
    for (const entry of readdirSync(taskDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(taskDir, entry.name);
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      prompts.push(validatePromptDefinition(parsed, filePath));
    }
  }

  return prompts;
}

function validatePromptDefinition(parsed: unknown, filePath: string): PromptDefinition {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid prompt file ${filePath}: expected object`);
  }
  const p = parsed as Record<string, unknown>;
  const required = ['id', 'version', 'task', 'template', 'variablesSchema', 'outputSchema'];
  for (const key of required) {
    if (!(key in p)) {
      throw new Error(`Invalid prompt file ${filePath}: missing ${key}`);
    }
  }
  return {
    id: String(p.id),
    version: String(p.version),
    task: String(p.task),
    template: String(p.template),
    variablesSchema: Array.isArray(p.variablesSchema)
      ? p.variablesSchema.map((v) => String(v))
      : [],
    outputSchema: Array.isArray(p.outputSchema) ? p.outputSchema.map((v) => String(v)) : [],
    defaultPolicy: { ...DEFAULT_POLICY, ...(p.defaultPolicy as LlmRequestPolicy | undefined) },
    guardrailProfile:
      (p.guardrailProfile as 'candidate_input' | 'jd_input' | 'internal_only' | undefined) ??
      'internal_only',
    providerOverrides:
      (p.providerOverrides as
        Record<string, Partial<LlmRequestPolicy> & Record<string, unknown>> | undefined) ?? {},
  };
}

/**
 * File-based registry of versioned prompts. Prompts are loaded from
 * `prompts/<task>/vX.Y.Z.json` at the api package root. Every production
 * completion is stamped `prompt@version`; provider-specific overrides can be
 * declared per prompt file.
 */
@Injectable()
export class PromptRegistry implements OnModuleInit {
  private readonly logger = new Logger(PromptRegistry.name);
  private readonly prompts = new Map<string, PromptDefinition>();

  constructor() {
    this.load();
  }

  onModuleInit(): void {
    this.logger.log(`Loaded ${this.prompts.size} prompt definition(s) from ${resolvePromptsDir()}`);
  }

  private load(): void {
    const loaded = loadPromptFiles();
    for (const prompt of loaded) {
      if (this.prompts.has(prompt.task)) {
        throw new Error(`Duplicate prompt task registered: ${prompt.task}`);
      }
      this.prompts.set(prompt.task, prompt);
    }
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

  /**
   * Resolve the effective policy for a provider, merging the prompt's default
   * policy with any provider-specific overrides declared in the prompt file.
   */
  resolvePolicy(task: string, providerName?: string): LlmRequestPolicy {
    const definition = this.get(task);
    const overrides = providerName ? definition.providerOverrides?.[providerName] : undefined;
    return { ...definition.defaultPolicy, ...overrides };
  }
}
