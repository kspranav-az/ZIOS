import { Module } from '@nestjs/common';
import { AnalysisModule } from '@/modules/analysis';
import { CandidatesModule } from '@/modules/candidates';
import { ConsentModule } from '@/modules/consent';
import { CreditsModule } from '@/modules/credits';
import { DatabaseModule } from '@/modules/database';
import { EvaluationModule } from '@/modules/evaluation';
import { InvitesModule } from '@/modules/invites';
import {
  KitsModule,
  KitsRepository,
  KitVersionsRepository,
  QuestionsRepository,
} from '@/modules/kits';
import { QueueModule } from '@/modules/queue';
import { SessionsModule } from '@/modules/sessions';
import { StorageClient } from '@/modules/storage';
import { AsyncVideoInterviewsController } from './async-video-interviews.controller';
import { AsyncVideoInterviewsService } from './async-video-interviews.service';
import { RoleKitResolverService } from './role-kit-resolver.service';
import { AsyncVideoTranscriptionService } from './transcription.service';
import { TranscriptionQueue } from './transcription.queue';
import { TranscriptionProcessor } from './transcription.processor';
import { TranscriptionDlqService } from './transcription-dlq.service';

@Module({
  imports: [
    DatabaseModule,
    AnalysisModule,
    CandidatesModule,
    ConsentModule,
    CreditsModule,
    EvaluationModule,
    KitsModule,
    InvitesModule,
    SessionsModule,
    QueueModule,
  ],
  controllers: [AsyncVideoInterviewsController],
  providers: [
    AsyncVideoInterviewsService,
    RoleKitResolverService,
    AsyncVideoTranscriptionService,
    TranscriptionQueue,
    TranscriptionProcessor,
    TranscriptionDlqService,
    StorageClient,
    KitsRepository,
    QuestionsRepository,
    KitVersionsRepository,
  ],
  exports: [AsyncVideoInterviewsService],
})
export class AsyncVideoInterviewsModule {}
