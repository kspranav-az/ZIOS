import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the ok health payload', () => {
    const logger = {
      setContext: vi.fn(),
      info: vi.fn(),
    } as unknown as PinoLogger;

    const controller = new HealthController(logger);

    expect(controller.check()).toEqual({ status: 'ok', service: 'api' });
    expect(logger.info).toHaveBeenCalledOnce();
  });
});
