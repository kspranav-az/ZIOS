import { Controller, Get } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { HealthResponse } from '@zios/shared-types';

@Controller()
export class HealthController {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HealthController.name);
  }

  @Get('healthz')
  check(): HealthResponse {
    this.logger.info('health check');
    return { status: 'ok', service: 'api' };
  }
}
