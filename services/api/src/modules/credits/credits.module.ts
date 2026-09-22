import { Module } from '@nestjs/common';
import { OrgModule } from '@/modules/org';
import { QueueModule } from '@/modules/queue';
import { NotificationsModule } from '@/modules/notifications';
import { CreditsService } from './credits.service';
import { CreditsAlertService } from './credits-alert.service';
import { CreditsController } from './credits.controller';

@Module({
  imports: [OrgModule, QueueModule, NotificationsModule],
  controllers: [CreditsController],
  providers: [CreditsService, CreditsAlertService],
  exports: [CreditsService, CreditsAlertService],
})
export class CreditsModule {}
