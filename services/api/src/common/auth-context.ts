/**
 * Auth context attached to the current HTTP request by SessionAuthMiddleware.
 *
 * Lives in src/common (shared kernel, ADR-0001) so both the auth module
 * (middleware/guards) and feature modules (controllers via @CurrentUser) can
 * use it without creating a module-import cycle.
 */
import type { Request } from 'express';
import type { AppUser } from '@zios/shared-types';

export interface RequestAuth {
  sessionId: string;
  user: AppUser;
}

const store = new WeakMap<Request, RequestAuth>();

export function setRequestAuth(req: Request, auth: RequestAuth): void {
  store.set(req, auth);
}

export function getRequestAuth(req: Request): RequestAuth | null {
  return store.get(req) ?? null;
}
