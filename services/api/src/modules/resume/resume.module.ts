import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth';
import { CandidateAccountsModule } from '@/modules/candidate-accounts';
import { LlmGatewayModule } from '@/modules/llm-gateway';
import { StorageClient } from '@/modules/storage';
import { CandidateResumeRepository } from './candidate-resume.repository';
import { ResumeController } from './resume.controller';
import { ResumeService } from './resume.service';

@Module({
  // AuthModule/CandidateAccountsModule: CandidateAuthGuard deps resolve in the
  // consuming module's context (same pattern as PracticeModule).
  imports: [AuthModule, CandidateAccountsModule, LlmGatewayModule],
  controllers: [ResumeController],
  providers: [CandidateResumeRepository, ResumeService, StorageClient],
  exports: [ResumeService],
})
export class ResumeModule {}
