import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { TenantContext } from './tenant-context';

/** Minimal query surface shared by Pool and PoolClient. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<pg.QueryResult>;
}

/**
 * Postgres access for the modular monolith. One pool per process; repositories
 * receive an optional Queryable so services can compose transactions.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DatabaseService.name);
    this.pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Tenant-scoped transaction. FAILS CLOSED when no TenantContext is present
   * (unauthenticated or pre-login code paths), and stamps app.org_id on the
   * connection so RLS policies can be attached later without call-site
   * changes ("RLS-ready tenancy helpers", phase-01 spec).
   */
  async withTenant<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const ctx = TenantContext.current();
    return this.transaction(async (client) => {
      await client.query("SELECT set_config('app.org_id', $1, true)", [ctx.orgId]);
      return fn(client);
    });
  }
}
