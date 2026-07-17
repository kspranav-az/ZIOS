/**
 * Route metadata decorators consumed by the global AuthGuard / RolesGuard
 * (auth module). Kept in src/common (shared kernel) so any feature module can
 * declare policy without importing the auth module — this keeps the module
 * dependency graph acyclic (org -> auth would otherwise cycle with
 * auth -> org for first-login provisioning).
 */
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AppUser, AppUserRole } from '@zios/shared-types';
import { getRequestAuth } from './auth-context';

export const IS_PUBLIC_KEY = 'zios:isPublic';

/** Marks a route reachable without a session. Everything else requires auth. */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'zios:roles';

/** Restricts a route to the given roles; RolesGuard answers 403 otherwise. */
export const Roles = (...roles: AppUserRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Parameter decorator injecting the authenticated user. Only meaningful on
 * guarded (non-public) routes — AuthGuard guarantees the context exists.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AppUser => {
    const req = ctx.switchToHttp().getRequest<Parameters<typeof getRequestAuth>[0]>();
    const auth = getRequestAuth(req);
    if (!auth) {
      throw new Error('@CurrentUser() used on a route without an authenticated request');
    }
    return auth.user;
  },
);
