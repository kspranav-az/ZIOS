import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { setRequestAuth } from '@/common/auth-context';
import { TenantContext } from '@/modules/database';
import { SESSION_COOKIE } from './auth.constants';
import { SessionService } from './session.service';

export function extractSessionToken(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const fromCookie = cookies?.[SESSION_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) {
    return fromCookie;
  }
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

/**
 * Resolves the session token (httpOnly cookie first, Bearer fallback) into
 * RequestAuth + TenantContext for the rest of the request chain. Absent or
 * invalid tokens simply continue without context — the AuthGuard decides
 * whether the route allows that (fail-closed on protected routes).
 */
@Injectable()
export class SessionAuthMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = extractSessionToken(req);
    if (!token) {
      next();
      return;
    }
    try {
      const auth = await this.sessions.resolve(token);
      if (!auth) {
        next();
        return;
      }
      setRequestAuth(req, auth);
      TenantContext.run(
        { orgId: auth.user.orgId, userId: auth.user.id, role: auth.user.role },
        () => next(),
      );
    } catch (error) {
      next(error);
    }
  }
}
