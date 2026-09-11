import { Module } from '@nestjs/common';
import { ConsentModule } from '@/modules/consent';
import { DatabaseModule } from '@/modules/database';
import { InvitesModule } from '@/modules/invites';
import { QueueModule } from '@/modules/queue';
import { SessionsModule } from '@/modules/sessions';
import { AnalysisController } from './analysis.controller';
import { AnalysisOrchestratorClient } from './analysis-orchestrator.client';
import { AnalysisProcessor } from './analysis.processor';
import { AnalysisQueue } from './analysis.queue';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [DatabaseModule, ConsentModule, InvitesModule, SessionsModule, QueueModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisQueue,
    AnalysisRepository,
    AnalysisOrchestratorClient,
    AnalysisProcessor,
    AnalysisService,
  ],
  exports: [AnalysisService, AnalysisRepository],
})
export class AnalysisModule {}
