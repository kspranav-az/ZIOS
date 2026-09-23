import { Injectable } from '@nestjs/common';
import type { CandidateHistoryResponse } from '@zios/shared-types';
import { CandidateAccountsService } from '@/modules/candidate-accounts';
import { PracticeEvaluationService } from '@/modules/practice/practice-evaluation.service';

/**
 * Read model only — composes the practice progress evaluator with the
 * exact-email-linked company interview rows. No writes of its own beyond the
 * lazy link upsert inside getCompanyHistory.
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly candidates: CandidateAccountsService,
    private readonly practiceEval: PracticeEvaluationService,
  ) {}

  async getHistory(accountId: string): Promise<CandidateHistoryResponse> {
    const [practice, company] = await Promise.all([
      this.practiceEval.getProgress(accountId),
      this.candidates.getCompanyHistory(accountId),
    ]);
    return { practice, company };
  }
}
