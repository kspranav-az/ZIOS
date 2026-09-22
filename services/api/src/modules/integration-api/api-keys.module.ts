import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/modules/database';
import { QueueModule } from '@/modules/queue';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from './api-key-auth.guard';
import { KeysController } from './keys.controller';

/**
 * Partner Integration API (Phase 10, FR-E13). This module owns API key
 * lifecycle + the ApiKeyGuard used by the /v1 controllers added in later
 * phase-10 branches (interviews endpoints, webhooks).
 */
@Module({
  imports: [DatabaseModule, QueueModule],
  controllers: [KeysController],
  providers: [ApiKeysRepository, ApiKeysService, ApiKeyGuard],
  exports: [ApiKeysService, ApiKeysRepository, ApiKeyGuard],
})
export class IntegrationApiModule {}
