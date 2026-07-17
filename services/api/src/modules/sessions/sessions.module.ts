import { Module } from '@nestjs/common';
import { CandidatesModule } from '@/modules/candidates';
import { ConsentModule } from '@/modules/consent';
import { DatabaseModule } from '@/modules/database';
import { KitsModule } from '@/modules/kits';
import { EventsRepository } from './events.repository';
import { INTERVIEWER_AI } from './interviewer-ai.port';
import { SessionsController } from './sessions.controller';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { StubConductorAdapter } from './stub-conductor.adapter';
import { TranscriptRepository } from './transcript.repository';

@Module({
  imports: [DatabaseModule, ConsentModule, CandidatesModule, KitsModule],
  controllers: [SessionsController],
  providers: [
    EventsRepository,
    SessionsRepository,
    SessionsService,
    TranscriptRepository,
    { provide: INTERVIEWER_AI, useClass: StubConductorAdapter },
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
