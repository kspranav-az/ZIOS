import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/modules/database';
import { EvaluationController } from './evaluation.controller';
import { DashboardController } from './dashboard.controller';
import { EvaluationService } from './evaluation.service';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationScoreRepository } from './score.repository';
import { EvidenceSpanRepository } from './evidence-span.repository';
import { OverrideRepository } from './override.repository';
import { OverrideService } from './override.service';
import { ShareLinkRepository } from './share-link.repository';
import { ShareLinkService } from './share-link.service';
import { PipelineLogRepository } from './pipeline-log.repository';
import { JUDGE_PORT } from './judge.port';
import { StubJudgeAdapter } from './stub-judge.adapter';

@Module({
  imports: [DatabaseModule],
  controllers: [EvaluationController, DashboardController],
  providers: [
    EvaluationRepository,
    EvaluationScoreRepository,
    EvidenceSpanRepository,
    OverrideRepository,
    ShareLinkRepository,
    PipelineLogRepository,
    EvaluationService,
    OverrideService,
    ShareLinkService,
    { provide: JUDGE_PORT, useClass: StubJudgeAdapter },
  ],
  exports: [EvaluationService],
})
export class EvaluationModule {}
