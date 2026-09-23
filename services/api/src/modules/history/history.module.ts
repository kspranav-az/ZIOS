import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth';
import { CandidateAccountsModule } from '@/modules/candidate-accounts';
import { PracticeModule } from '@/modules/practice';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  // AuthModule: CandidateAuthGuard deps resolve in the consuming module's
  // context (same pattern as PracticeModule/ResumeModule).
  imports: [AuthModule, CandidateAccountsModule, PracticeModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
