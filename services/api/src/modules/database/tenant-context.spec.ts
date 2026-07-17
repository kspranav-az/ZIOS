import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import { DatabaseService } from './database.service';
import { TenantContext, TenantContextMissingError } from './tenant-context';

const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;

describe('TenantContext', () => {
  it('exposes the value inside run() only', () => {
    expect(TenantContext.currentOrNull()).toBeNull();
    const seen = TenantContext.run({ orgId: 'o1', userId: 'u1', role: 'admin' }, () =>
      TenantContext.current(),
    );
    expect(seen).toEqual({ orgId: 'o1', userId: 'u1', role: 'admin' });
    expect(TenantContext.currentOrNull()).toBeNull();
  });

  it('fails closed when current() is called without a context', () => {
    expect(() => TenantContext.current()).toThrow(TenantContextMissingError);
  });
});

describe('DatabaseService.withTenant', () => {
  it('refuses to run without a tenant context (fail closed)', async () => {
    const db = new DatabaseService(logger);
    await expect(db.withTenant(async () => 'never')).rejects.toBeInstanceOf(
      TenantContextMissingError,
    );
    await db.onModuleDestroy();
  });

  it('stamps app.org_id on the connection when a context exists', async () => {
    const db = new DatabaseService(logger);
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    const transaction = vi
      .spyOn(db, 'transaction')
      .mockImplementation(async (fn) => fn(client as unknown as pg.PoolClient));

    await TenantContext.run({ orgId: 'org-42', userId: 'u1', role: 'admin' }, () =>
      db.withTenant(async (c) => {
        await c.query('SELECT 1');
      }),
    );

    expect(client.query).toHaveBeenNthCalledWith(1, "SELECT set_config('app.org_id', $1, true)", [
      'org-42',
    ]);
    transaction.mockRestore();
    await db.onModuleDestroy();
  });
});
