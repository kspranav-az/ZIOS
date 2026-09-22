import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/modules/database';
import { EvaluationModule } from '@/modules/evaluation';
import { GenerationModule } from '@/modules/generation';
import { InvitesModule } from '@/modules/invites';
import { KitsModule } from '@/modules/kits';
import { QueueModule } from '@/modules/queue';
import { SessionsModule } from '@/modules/sessions';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from './api-key-auth.guard';
import { KeysController } from './keys.controller';
import { ExternalInterviewRepository } from './external-interview.repository';
import { V1InterviewsService } from './v1-interviews.service';
import { InterviewsController } from './interviews.controller';

/**
 * Partner Integration API (Phase 10, FR-E13). This module owns API key
 * lifecycle, the ApiKeyGuard, and the /v1 partner endpoints (interviews
 * now; webhooks + credits wiring land in later phase-10 branches).
 */
@Module({
  imports: [
    DatabaseModule,
    QueueModule,
    InvitesModule,
    KitsModule,
    GenerationModule,
    EvaluationModule,
    SessionsModule,
  ],
  controllers: [KeysController, InterviewsController],
  providers: [
    ApiKeysRepository,
    ApiKeysService,
    ApiKeyGuard,
    ExternalInterviewRepository,
    V1InterviewsService,
  ],
  exports: [ApiKeysService, ApiKeysRepository, ApiKeyGuard],
})
export class IntegrationApiModule {}
