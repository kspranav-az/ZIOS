import type { LlmProvider } from './contracts';

/**
 * Provider that always throws. Used in gateway contract tests to prove that
 * fallback never fails open and circuit-breaker state opens correctly.
 */
export class FailingLlmProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel = 'failing-model';
  readonly costPer1kInput = 0;
  readonly costPer1kOutput = 0;

  constructor(name = 'failing') {
    this.name = name;
  }

  async complete(): Promise<{ text: string; tokensIn: number; tokensOut: number; model?: string }> {
    throw new Error(`FailingLlmProvider ${this.name} is down`);
  }
}
