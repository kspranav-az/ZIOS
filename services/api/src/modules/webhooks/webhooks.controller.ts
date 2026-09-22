import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { AppUser } from '@zios/shared-types';
import { CurrentUser, Roles } from '@/common/decorators';
import {
  WEBHOOK_EVENTS,
  WebhooksRepository,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEvent,
} from './webhooks.repository';
import { WebhooksQueue } from './webhooks.queue';
import { generateWebhookSecret } from './webhook-signing';

export interface CreateWebhookEndpointBody {
  url?: string;
  events?: string[];
}

export interface WebhookEndpointCreated {
  endpoint: Omit<WebhookEndpoint, 'secret'>;
  secret: string;
}

export interface WebhookEndpointListResponse {
  endpoints: Array<Omit<WebhookEndpoint, 'secret'>>;
}

export interface WebhookDeliveryListResponse {
  deliveries: WebhookDelivery[];
}

function normalizeUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new BadRequestException('url is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestException('url must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('url must be http(s)');
  }
  // Plain http is only acceptable for local development sinks.
  if (parsed.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname)) {
    throw new BadRequestException('url must use https unless it targets localhost');
  }
  return parsed.toString();
}

function normalizeEvents(raw: unknown): WebhookEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException('events must be a non-empty array');
  }
  const events = [...new Set(raw)];
  if (events.some((event) => !(WEBHOOK_EVENTS as readonly string[]).includes(event))) {
    throw new BadRequestException(
      `events must be a subset of ${WEBHOOK_EVENTS.map((event) => `"${event}"`).join(', ')}`,
    );
  }
  return events as WebhookEvent[];
}

function publicView(endpoint: WebhookEndpoint): Omit<WebhookEndpoint, 'secret'> {
  const { secret: _secret, ...view } = endpoint;
  return view;
}

/**
 * Org webhook management (FR-E13-4). Session-authed like the rest of the
 * employer UI. The signing secret is shown exactly once at creation.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksRepository,
    private readonly queue: WebhooksQueue,
  ) {}

  @Post('endpoints')
  @Roles('admin')
  async create(
    @CurrentUser() user: AppUser,
    @Body() body: CreateWebhookEndpointBody,
  ): Promise<WebhookEndpointCreated> {
    const endpoint = await this.webhooks.insertEndpoint({
      orgId: user.orgId,
      url: normalizeUrl(body?.url),
      secret: generateWebhookSecret(),
      events: normalizeEvents(body?.events),
    });
    return { endpoint: publicView(endpoint), secret: endpoint.secret };
  }

  @Get('endpoints')
  async list(@CurrentUser() user: AppUser): Promise<WebhookEndpointListResponse> {
    const endpoints = await this.webhooks.listEndpoints(user.orgId);
    return { endpoints: endpoints.map(publicView) };
  }

  @Post('endpoints/:id/deactivate')
  @HttpCode(200)
  @Roles('admin')
  async deactivate(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const ok = await this.webhooks.setActive(id, user.orgId, false);
    if (!ok) throw new NotFoundException('endpoint not found');
    return { ok: true };
  }

  @Get('deliveries')
  @Roles('admin')
  async deliveries(
    @CurrentUser() user: AppUser,
    @Query('status') status?: string,
    @Query('endpointId') endpointId?: string,
  ): Promise<WebhookDeliveryListResponse> {
    const normalized =
      status === 'pending' || status === 'delivered' || status === 'failed' ? status : undefined;
    const deliveries = await this.webhooks.listDeliveries(user.orgId, {
      status: normalized,
      endpointId,
    });
    return { deliveries };
  }

  @Post('deliveries/:id/replay')
  @HttpCode(200)
  @Roles('admin')
  async replay(@CurrentUser() user: AppUser, @Param('id') id: string): Promise<{ ok: true }> {
    const delivery = await this.webhooks.findDeliveryById(id);
    if (!delivery) throw new NotFoundException('delivery not found');
    // Org-scope check: the delivery's endpoint must belong to the caller.
    const endpoint = await this.webhooks.findEndpointById(delivery.endpointId, user.orgId);
    if (!endpoint) throw new NotFoundException('delivery not found');
    await this.webhooks.resetForReplay(id);
    await this.queue.add(id);
    return { ok: true };
  }
}
