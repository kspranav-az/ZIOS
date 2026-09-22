import { Module } from '@nestjs/common';
import { QueueModule } from '@/modules/queue';
import { NotificationsModule } from '@/modules/notifications';
import { CreditsService } from './credits.service';
import { CreditsAlertService } from './credits-alert.service';
import { CreditsController } from './credits.controller';

@Module({
  imports: [QueueModule, NotificationsModule],
  controllers: [CreditsController],
  providers: [CreditsService, CreditsAlertService],
  exports: [CreditsService, CreditsAlertService],
})
export class CreditsModule {}
