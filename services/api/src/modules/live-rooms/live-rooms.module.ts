import { Module } from '@nestjs/common';
import { CandidatesModule } from '@/modules/candidates';
import { DatabaseModule } from '@/modules/database';
import { EvaluationModule } from '@/modules/evaluation';
import { InterviewNotesRepository } from '@/modules/evaluation';
import { InvitesModule } from '@/modules/invites';
import { KitsModule } from '@/modules/kits';
import { SessionsModule } from '@/modules/sessions';
import { CoverageRepository } from './coverage.repository';
import { InterviewSlotRepository } from './slot.repository';
import { LiveRoomsController } from './live-rooms.controller';
import { LiveRoomsService } from './live-rooms.service';
import { NotesService } from './notes.service';

@Module({
  imports: [
    DatabaseModule,
    SessionsModule,
    EvaluationModule,
    KitsModule,
    CandidatesModule,
    InvitesModule,
  ],
  controllers: [LiveRoomsController],
  providers: [
    InterviewSlotRepository,
    CoverageRepository,
    InterviewNotesRepository,
    NotesService,
    LiveRoomsService,
  ],
  exports: [LiveRoomsService],
})
export class LiveRoomsModule {}
