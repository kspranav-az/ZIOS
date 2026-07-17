import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AppUser } from '@zios/shared-types';
import { setRequestAuth } from '@/common/auth-context';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

export function makeUser(role: AppUser['role'] = 'admin'): AppUser {
  return {
    id: 'user-1',
    orgId: 'org-1',
    email: 'a@acme.com',
    name: 'A',
    role,
    createdAt: new Date().toISOString(),
  };
}

function contextFor(req: Request): ExecutionContext {
  const handler = (): void => {};
  class Ctrl {}
  return {
    getHandler: () => handler,
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => req, getResponse: vi.fn(), getNext: vi.fn() }),
    getArgs: vi.fn(),
    getArgByIndex: vi.fn(),
    switchToRpc: vi.fn(),
    switchToWs: vi.fn(),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function reflectorReturning(value: unknown): Reflector {
  return { getAllAndOverride: vi.fn(() => value) } as unknown as Reflector;
}

describe('AuthGuard', () => {
  it('lets @Public routes through without any session', () => {
    const guard = new AuthGuard(reflectorReturning(true));
    expect(guard.canActivate(contextFor({} as Request))).toBe(true);
  });

  it('401s protected routes without a session', () => {
    const guard = new AuthGuard(reflectorReturning(undefined));
    expect(() => guard.canActivate(contextFor({} as Request))).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'UNAUTHENTICATED' }),
      }),
    );
  });

  it('lets authenticated requests through', () => {
    const req = {} as Request;
    setRequestAuth(req, { sessionId: 's1', user: makeUser() });
    const guard = new AuthGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextFor(req))).toBe(true);
  });
});

describe('RolesGuard', () => {
  it('allows routes without a @Roles declaration for any authenticated role', () => {
    const req = {} as Request;
    setRequestAuth(req, { sessionId: 's1', user: makeUser('interviewer') });
    const guard = new RolesGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextFor(req))).toBe(true);
  });

  it('allows when the user role is listed', () => {
    const req = {} as Request;
    setRequestAuth(req, { sessionId: 's1', user: makeUser('admin') });
    const guard = new RolesGuard(reflectorReturning(['admin']));
    expect(guard.canActivate(contextFor(req))).toBe(true);
  });

  it('403s when the user role is not listed', () => {
    const req = {} as Request;
    setRequestAuth(req, { sessionId: 's1', user: makeUser('interviewer') });
    const guard = new RolesGuard(reflectorReturning(['admin']));
    expect(() => guard.canActivate(contextFor(req))).toThrowError(
      expect.objectContaining({
        status: 403,
        response: expect.objectContaining({ code: 'FORBIDDEN_ROLE' }),
      }),
    );
  });

  it('defers to AuthGuard when there is no auth context (public route)', () => {
    const guard = new RolesGuard(reflectorReturning(['admin']));
    expect(guard.canActivate(contextFor({} as Request))).toBe(true);
  });
});
