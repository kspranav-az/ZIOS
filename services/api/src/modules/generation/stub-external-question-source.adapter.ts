import { Injectable } from '@nestjs/common';
import type { QuestionBankItem } from '@zios/shared-types';
import { QuestionBankRepository } from '@/modules/question-bank';
import { ExternalQuestionSourcePort } from './external-question-source.port';

/**
 * Stub external question source for Phase 05: searches the internal question
 * bank as if it were an external provider. The org-scoped signature is kept
 * so the future real adapter can apply per-org auth config without changing
 * callers.
 */
@Injectable()
export class StubExternalQuestionSourceAdapter implements ExternalQuestionSourcePort {
  constructor(private readonly bank: QuestionBankRepository) {}

  async search(_orgId: string, query: string): Promise<QuestionBankItem[]> {
    const { items } = await this.bank.search({ query, page: 1 });
    // Cap results so the planner stays in control of the mix.
    return items.slice(0, 5);
  }
}
