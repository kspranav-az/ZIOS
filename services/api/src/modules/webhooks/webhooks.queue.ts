import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';

export interface WebhookJobData {
  deliveryId: string;
}

export interface WebhookJobResult {
  status: 'delivered';
}

export function getWebhookQueueName(): string {
  return process.env.WEBHOOK_QUEUE_NAME ?? 'webhook-delivery';
}

@Injectable()
export class WebhooksQueue implements OnModuleDestroy {
  private readonly queue: Queue<WebhookJobData, WebhookJobResult>;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {
    this.queue = new Queue<WebhookJobData, WebhookJobResult>(getWebhookQueueName(), {
      connection: this.redis,
    });
  }

  async add(deliveryId: string, delayMs = 0): Promise<Job<WebhookJobData, WebhookJobResult>> {
    return this.queue.add('deliver', { deliveryId }, { delay: delayMs });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
