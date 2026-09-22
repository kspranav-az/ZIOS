import { Module } from '@nestjs/common';
import { QueueModule } from '@/modules/queue';
import { DatabaseModule } from '@/modules/database';
import { WebhooksRepository } from './webhooks.repository';
import { WebhooksQueue } from './webhooks.queue';
import { WebhookFanoutService } from './webhook-fanout.service';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [QueueModule, DatabaseModule],
  controllers: [WebhooksController],
  providers: [WebhooksRepository, WebhooksQueue, WebhookFanoutService, WebhooksProcessor],
  exports: [WebhooksRepository, WebhooksQueue, WebhookFanoutService],
})
export class WebhooksModule {}
