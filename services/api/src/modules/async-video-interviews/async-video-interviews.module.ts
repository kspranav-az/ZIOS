import { Module } from '@nestjs/common';
import { CandidatesModule } from '@/modules/candidates';
import { ConsentModule } from '@/modules/consent';
import { DatabaseModule } from '@/modules/database';
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
    CandidatesModule,
    ConsentModule,
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
