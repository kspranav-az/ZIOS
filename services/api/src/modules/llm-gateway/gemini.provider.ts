import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai';
import { ApiException } from '@/common/errors';
import type { LlmProvider, LlmRequestPolicy } from './contracts';

/**
 * Approximate Gemini Flash list pricing in USD per 1k tokens.
 * Updated periodically; used for cost telemetry only.
 */
const GEMINI_FLASH_INPUT_COST_PER_1K = 0.000075;
const GEMINI_FLASH_OUTPUT_COST_PER_1K = 0.0003;
const GEMINI_PRO_INPUT_COST_PER_1K = 0.00125;
const GEMINI_PRO_OUTPUT_COST_PER_1K = 0.005;

function resolveCostPer1k(model: string, direction: 'input' | 'output'): number {
  const lower = model.toLowerCase();
  if (lower.includes('flash')) {
    return direction === 'input' ? GEMINI_FLASH_INPUT_COST_PER_1K : GEMINI_FLASH_OUTPUT_COST_PER_1K;
  }
  return direction === 'input' ? GEMINI_PRO_INPUT_COST_PER_1K : GEMINI_PRO_OUTPUT_COST_PER_1K;
}

function estimateTokens(text: string): number {
  // Rough heuristic when usage metadata is unavailable.
  return Math.ceil(text.length / 4);
}

/**
 * Google Gemini adapter implementing the shared LlmProvider port.
 *
 * The adapter is deliberately thin: it only marshals the prompt to Gemini and
 * returns raw text + token counts. JSON parsing, output schema validation,
 * caching, routing, and cost attribution live in LlmGateway.
 */
@Injectable()
export class GeminiLlmProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name);
  readonly name = 'gemini';
  readonly defaultModel: string;
  readonly costPer1kInput: number;
  readonly costPer1kOutput: number;

  private readonly client: GoogleGenerativeAI;

  constructor(apiKey?: string, defaultModel?: string) {
    const key = apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
    if (!key) {
      throw new Error('GeminiLlmProvider requires GEMINI_API_KEY or an explicit apiKey');
    }
    this.defaultModel =
      defaultModel?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash';
    this.client = new GoogleGenerativeAI(key);
    this.costPer1kInput = resolveCostPer1k(this.defaultModel, 'input');
    this.costPer1kOutput = resolveCostPer1k(this.defaultModel, 'output');
  }

  async complete(input: {
    task: string;
    promptText: string;
    variables: Record<string, unknown>;
    policy?: LlmRequestPolicy;
  }): Promise<{ text: string; tokensIn: number; tokensOut: number; model?: string }> {
    const modelName = input.policy?.model ?? this.defaultModel;
    const config: GenerationConfig = {
      responseMimeType: 'application/json',
      temperature: input.policy?.temperature ?? 0.2,
      topP: input.policy?.topP,
      maxOutputTokens: input.policy?.maxOutputTokens,
    };

    // Remove undefined fields so Gemini does not receive them.
    if (config.topP === undefined) delete config.topP;
    if (config.maxOutputTokens === undefined) delete config.maxOutputTokens;

    const model = this.client.getGenerativeModel({
      model: modelName,
      generationConfig: config,
      systemInstruction:
        'You are a backend API. Always respond with valid, compact JSON matching the requested schema. Do not include markdown or explanations.',
    });

    try {
      const result = await model.generateContent(input.promptText);
      const response = result.response;
      const text = response.text();

      const usage = response.usageMetadata;
      const tokensIn = usage?.promptTokenCount ?? estimateTokens(input.promptText);
      const tokensOut = usage?.candidatesTokenCount ?? estimateTokens(text);

      return { text, tokensIn, tokensOut, model: modelName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Gemini call failed for task ${input.task}: ${message}`);
      throw new ApiException(
        502,
        'LLM_PROVIDER_ERROR',
        `LLM_PROVIDER_ERROR: Gemini error: ${message}`,
      );
    }
  }
}
