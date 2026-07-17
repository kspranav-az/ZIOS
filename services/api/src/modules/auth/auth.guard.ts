import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { getRequestAuth } from '@/common/auth-context';
import { IS_PUBLIC_KEY } from '@/common/decorators';
import { ApiException } from '@/common/errors';

/**
 * Global authentication gate (APP_GUARD): every route requires a resolved
 * session unless it is marked @Public(). Runs after SessionAuthMiddleware,
 * which is what populates the request auth context.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (!getRequestAuth(req)) {
      throw new ApiException(401, 'UNAUTHENTICATED', 'a valid session is required');
    }
    return true;
  }
}
