import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CandidatesModule } from '@/modules/candidates';
import { ConsentModule } from '@/modules/consent';
import { DatabaseModule } from '@/modules/database';
import { KitsModule } from '@/modules/kits';
import { NotificationsModule } from '@/modules/notifications';
import { SessionsModule } from '@/modules/sessions';
import { CandidateOtpRepository } from './candidate-otp.repository';
import { CandidateOtpService } from './candidate-otp.service';
import { CsvParserService } from './csv-parser.service';
import { InvitesController } from './invites.controller';
import { InvitesRepository } from './invites.repository';
import { InvitesService } from './invites.service';
import { RemindersCron } from './reminders.cron';
import { RemindersService } from './reminders.service';

@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    CandidatesModule,
    KitsModule,
    ConsentModule,
    SessionsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [InvitesController],
  providers: [
    CandidateOtpRepository,
    CandidateOtpService,
    CsvParserService,
    InvitesRepository,
    InvitesService,
    RemindersCron,
    RemindersService,
  ],
  exports: [InvitesService, CandidateOtpService],
})
export class InvitesModule {}
