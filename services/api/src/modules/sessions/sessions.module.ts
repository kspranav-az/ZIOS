import { Module } from '@nestjs/common';
import { CandidatesModule } from '@/modules/candidates';
import { ConsentModule } from '@/modules/consent';
import { DatabaseModule } from '@/modules/database';
import { EvaluationModule } from '@/modules/evaluation';
import { KitsModule } from '@/modules/kits';
import { LlmGatewayModule } from '@/modules/llm-gateway';
import { EventsRepository } from './events.repository';
import { INTERVIEWER_AI } from './interviewer-ai.port';
import { LlmConductorAdapter } from './llm-conductor.adapter';
import { SessionsController } from './sessions.controller';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { TranscriptRepository } from './transcript.repository';

@Module({
  imports: [
    DatabaseModule,
    ConsentModule,
    CandidatesModule,
    EvaluationModule,
    KitsModule,
    LlmGatewayModule,
  ],
  controllers: [SessionsController],
  providers: [
    EventsRepository,
    SessionsRepository,
    SessionsService,
    TranscriptRepository,
    { provide: INTERVIEWER_AI, useClass: LlmConductorAdapter },
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
