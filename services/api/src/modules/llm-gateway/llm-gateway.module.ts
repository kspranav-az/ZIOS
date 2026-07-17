import { Module } from '@nestjs/common';
import { LlmGateway } from './llm-gateway.service';
import { Guardrails } from './guardrails';
import { MockLlmProvider } from './mock-llm.provider';
import { PromptRegistry } from './prompt-registry';

@Module({
  providers: [LlmGateway, PromptRegistry, Guardrails, MockLlmProvider],
  exports: [LlmGateway, PromptRegistry, Guardrails],
})
export class LlmGatewayModule {
  constructor(
    private readonly gateway: LlmGateway,
    private readonly mock: MockLlmProvider,
  ) {
    // Register the default mock provider on module init. Additional providers
    // (real adapters, second mock tier) can be registered at runtime.
    this.gateway.registerProvider(this.mock);
  }
}
