import { Controller, Get, UseGuards } from '@nestjs/common';
import type { CandidateHistoryResponse } from '@zios/shared-types';
import { Public } from '@/common/decorators';
import {
  CandidateAuthGuard,
  CurrentCandidate,
  type CandidateAuthContext,
} from '@/modules/candidate-accounts';
import { HistoryService } from './history.service';

/**
 * Candidate interview history (Phase 12e, Step 3): one read model combining
 * the candidate's own practice mocks (practice progress payload) with
 * company interviews linked by exact email match. Lives in its own module so
 * neither candidate-accounts nor practice needs a circular import.
 */
@Controller('cand')
export class HistoryController {
  constructor(private readonly service: HistoryService) {}

  @Public()
  @UseGuards(CandidateAuthGuard)
  @Get('me/history')
  async history(@CurrentCandidate() auth: CandidateAuthContext): Promise<CandidateHistoryResponse> {
    return this.service.getHistory(auth.account.id);
  }
}
