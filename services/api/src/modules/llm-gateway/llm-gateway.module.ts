import { Logger, Module } from '@nestjs/common';
import { GeminiLlmProvider } from './gemini.provider';
import { Guardrails } from './guardrails';
import { LlmGateway } from './llm-gateway.service';
import { MockLlmProvider } from './mock-llm.provider';
import { PromptRegistry } from './prompt-registry';

@Module({
  providers: [LlmGateway, PromptRegistry, Guardrails, MockLlmProvider],
  exports: [LlmGateway, PromptRegistry, Guardrails],
})
export class LlmGatewayModule {
  private readonly logger = new Logger(LlmGatewayModule.name);

  constructor(
    private readonly gateway: LlmGateway,
    private readonly mock: MockLlmProvider,
  ) {
    // Register the deterministic mock provider on every boot. It is the safe
    // default and keeps tests/local development free of external API calls.
    this.gateway.registerProvider(this.mock);

    const mode = process.env.LLM_MODE?.trim() ?? 'mock';
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (mode === 'gemini') {
      if (apiKey) {
        this.gateway.registerProvider(new GeminiLlmProvider(apiKey));
        this.logger.log('Registered Gemini LLM provider');
      } else {
        this.logger.warn(
          'LLM_MODE=gemini but GEMINI_API_KEY is missing; falling back to mock provider only',
        );
      }
    }
  }
}
