/**
 * Request-scoped tenant context (PRD: every request carries org_id; missing
 * context fails closed). Populated by SessionAuthMiddleware via
 * AsyncLocalStorage, so the whole downstream async chain (guards, pipes,
 * handlers, repositories) observes the same value without parameter passing.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppUserRole } from '@zios/shared-types';

export interface TenantContextValue {
  orgId: string;
  userId: string;
  role: AppUserRole;
}

export class TenantContextMissingError extends Error {
  constructor() {
    super('tenant context is missing — refusing to run a tenant-scoped operation (fail closed)');
    this.name = 'TenantContextMissingError';
  }
}

const storage = new AsyncLocalStorage<TenantContextValue>();

export const TenantContext = {
  run<T>(value: TenantContextValue, fn: () => T): T {
    return storage.run(value, fn);
  },
  /** Fail-closed accessor: throws TenantContextMissingError when unset. */
  current(): TenantContextValue {
    const value = storage.getStore();
    if (!value) {
      throw new TenantContextMissingError();
    }
    return value;
  },
  currentOrNull(): TenantContextValue | null {
    return storage.getStore() ?? null;
  },
};
