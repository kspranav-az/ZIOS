import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth';
import { CandidateAccountsModule } from '@/modules/candidate-accounts';
import { CreditsModule } from '@/modules/credits';
import { EvaluationModule } from '@/modules/evaluation';
import { LlmGatewayModule } from '@/modules/llm-gateway';
import { ResumeModule } from '@/modules/resume';
import { SessionsModule } from '@/modules/sessions';
import { PracticeController } from './practice.controller';
import { PracticeEvaluationService } from './practice-evaluation.service';
import { PracticeReportRepository } from './practice-report.repository';
import { PracticeService } from './practice.service';
import { PracticeSessionRepository } from './practice-session.repository';
import { PracticeTranscriptRepository } from './practice-transcript.repository';

@Module({
  imports: [
    AuthModule,
    CandidateAccountsModule,
    CreditsModule,
    EvaluationModule,
    LlmGatewayModule,
    ResumeModule,
    SessionsModule,
  ],
  controllers: [PracticeController],
  providers: [
    PracticeService,
    PracticeEvaluationService,
    PracticeSessionRepository,
    PracticeTranscriptRepository,
    PracticeReportRepository,
  ],
  exports: [PracticeService, PracticeEvaluationService],
})
export class PracticeModule {}
