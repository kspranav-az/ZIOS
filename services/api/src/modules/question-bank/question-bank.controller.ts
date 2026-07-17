import { Controller, Get, Query } from '@nestjs/common';
import type { BankSearchResponse } from '@zios/shared-types';
import { QuestionBankService, type BankSearchParams } from './question-bank.service';

/**
 * Question-bank routes (FR-E4-1). Any authenticated role may search; the bank
 * is global seeded reference data shared by all orgs.
 */
@Controller('bank')
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

  @Get('questions')
  search(@Query() params: BankSearchParams): Promise<BankSearchResponse> {
    return this.bank.search(params);
  }
}
