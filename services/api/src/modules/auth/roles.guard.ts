import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AppUserRole } from '@zios/shared-types';
import { getRequestAuth } from '@/common/auth-context';
import { ROLES_KEY } from '@/common/decorators';
import { ApiException } from '@/common/errors';

/**
 * Centralized authorization (Blueprint §18.2 — no scattered role checks):
 * routes declare @Roles(...), this guard enforces. Routes without @Roles are
 * open to any authenticated role; public routes skip entirely.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppUserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const auth = getRequestAuth(req);
    // Public routes carry no auth context; the AuthGuard owns the 401 decision.
    if (!auth) {
      return true;
    }
    if (!required.includes(auth.user.role)) {
      throw new ApiException(
        403,
        'FORBIDDEN_ROLE',
        `this route requires role: ${required.join(' | ')}`,
      );
    }
    return true;
  }
}
