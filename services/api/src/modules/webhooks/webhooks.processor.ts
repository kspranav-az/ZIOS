import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from '@/modules/queue';
import { DatabaseService } from '@/modules/database';
import { WebhooksRepository } from './webhooks.repository';
import { WebhooksQueue, getWebhookQueueName, type WebhookJobData, type WebhookJobResult } from './webhooks.queue';
import {
  MAX_DELIVERY_ATTEMPTS,
  backoffDelayMs,
  signWebhookBody,
} from './webhook-signing';

const REQUEST_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 10_000);

@Injectable()
export class WebhooksProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksProcessor.name);
  private worker: Worker<WebhookJobData, WebhookJobResult> | undefined;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly db: DatabaseService,
    private readonly webhooks: WebhooksRepository,
    private readonly queue: WebhooksQueue,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<WebhookJobData, WebhookJobResult>(
      getWebhookQueueName(),
      async (job) => this.process(job),
      { connection: this.redis },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  async process(job: Job<WebhookJobData, WebhookJobResult>): Promise<WebhookJobResult> {
    const delivery = await this.webhooks.findDeliveryById(job.data.deliveryId);
    if (!delivery) {
      this.logger.warn(`delivery ${job.data.deliveryId} vanished; skipping`);
      return { status: 'delivered' };
    }
    if (delivery.status === 'delivered') {
      return { status: 'delivered' };
    }
    const target = await this.lookupEndpoint(delivery.endpointId);
    if (!target || !target.active) {
      // Endpoint gone or deactivated: leave the row pending; admin replay can
      // re-enqueue after re-subscribing. Not a delivery attempt.
      return { status: 'delivered' };
    }

    const rawBody = JSON.stringify({ id: delivery.id, ...delivery.payload });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookBody(target.secret, rawBody, timestamp);

    let responseCode: number | null = null;
    let error: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(target.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zios-signature': signature,
          'x-zios-event': delivery.event,
        },
        body: rawBody,
        signal: controller.signal,
      });
      clearTimeout(timer);
      responseCode = response.status;
      if (!response.ok) {
        error = `subscriber returned ${response.status}`;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    await this.db.transaction(async (q) => {
      await this.webhooks.markAttempt(delivery.id, { responseCode, error }, q);
      if (error === null) {
        await this.webhooks.markDelivered(delivery.id, q);
        return;
      }
      const attempts = delivery.attempts + 1;
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await this.webhooks.markFailed(delivery.id, q);
        this.logger.warn(
          `delivery ${delivery.id} exhausted ${MAX_DELIVERY_ATTEMPTS} attempts: ${error}`,
        );
        return;
      }
      const delayMs = backoffDelayMs(attempts);
      await this.webhooks.scheduleRetry(
        delivery.id,
        new Date(Date.now() + delayMs),
        q,
      );
      await this.queue.add(delivery.id, delayMs);
    });

    return { status: 'delivered' };
  }

  /** Endpoint lookup without org scoping (the worker is not tenant-bound). */
  private async lookupEndpoint(id: string) {
    const result = await this.db.query(
      `SELECT id, org_id, url, secret, events, active, created_at
       FROM webhook_endpoint WHERE id = $1`,
      [id],
    );
    const row = result.rows[0] as
      | { id: string; org_id: string; url: string; secret: string; events: string[]; active: boolean; created_at: Date }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.org_id,
      url: row.url,
      secret: row.secret,
      events: row.events,
      active: row.active,
      createdAt: row.created_at.toISOString(),
    };
  }
}
