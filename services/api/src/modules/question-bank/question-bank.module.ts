import { Module } from '@nestjs/common';
import { QuestionBankController } from './question-bank.controller';
import { QuestionBankRepository } from './question-bank.repository';
import { QuestionBankService } from './question-bank.service';

@Module({
  controllers: [QuestionBankController],
  providers: [QuestionBankRepository, QuestionBankService],
  // KitsModule clones bank items into kits (source='bank' provenance, FR-E4-3).
  exports: [QuestionBankRepository],
})
export class QuestionBankModule {}
