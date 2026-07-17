import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/modules/database';
import { LlmGatewayModule } from '@/modules/llm-gateway';
import { EvaluationController } from './evaluation.controller';
import { DashboardController } from './dashboard.controller';
import { EvaluationService } from './evaluation.service';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationScoreRepository } from './score.repository';
import { EvidenceSpanRepository } from './evidence-span.repository';
import { JudgeEnsembleAdapter } from './judge-ensemble.adapter';
import { OverrideRepository } from './override.repository';
import { OverrideService } from './override.service';
import { ShareLinkRepository } from './share-link.repository';
import { ShareLinkService } from './share-link.service';
import { PipelineLogRepository } from './pipeline-log.repository';
import { InterviewNotesRepository } from './notes.repository';
import { JUDGE_PORT } from './judge.port';

@Module({
  imports: [DatabaseModule, LlmGatewayModule],
  controllers: [EvaluationController, DashboardController],
  providers: [
    EvaluationRepository,
    EvaluationScoreRepository,
    EvidenceSpanRepository,
    OverrideRepository,
    ShareLinkRepository,
    PipelineLogRepository,
    InterviewNotesRepository,
    EvaluationService,
    OverrideService,
    ShareLinkService,
    { provide: JUDGE_PORT, useClass: JudgeEnsembleAdapter },
  ],
  exports: [EvaluationService],
})
export class EvaluationModule {}
