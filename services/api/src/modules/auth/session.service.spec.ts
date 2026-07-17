import { describe, expect, it, vi } from 'vitest';
import type { AppUser } from '@zios/shared-types';
import { SESSION_TTL_DAYS } from './auth.constants';
import { SessionRepository, type SessionWithUser } from './session.repository';
import { SessionService } from './session.service';

const user: AppUser = {
  id: 'user-1',
  orgId: 'org-1',
  email: 'admin@acme.com',
  name: 'Admin',
  role: 'admin',
  createdAt: new Date().toISOString(),
};

function activeSession(expiresAt = new Date(Date.now() + 60_000)): SessionWithUser {
  return { sessionId: 'session-1', sessionExpiresAt: expiresAt, user };
}

function makeService(found: SessionWithUser | null) {
  const repo = {
    insert: vi.fn(
      async (_input: { userId: string; tokenHash: string; expiresAt: Date }) => 'session-1',
    ),
    findActiveWithUser: vi.fn(async () => found),
    touch: vi.fn(async (_id: string, _expiresAt: Date) => {}),
    revoke: vi.fn(async (_id: string) => {}),
  };
  const service = new SessionService(repo as unknown as SessionRepository);
  return { service, repo };
}

describe('SessionService.create', () => {
  it('mints an opaque 32-byte token and stores only its sha256 hash', async () => {
    const { service, repo } = makeService(null);

    const session = await service.create(user.id);

    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + (SESSION_TTL_DAYS - 1) * 24 * 60 * 60 * 1000,
    );
    const stored = repo.insert.mock.calls[0]?.[0] as { userId: string; tokenHash: string };
    expect(stored.userId).toBe(user.id);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(session.token);
  });
});

describe('SessionService.resolve', () => {
  it('returns null for unknown tokens', async () => {
    const { service } = makeService(null);
    expect(await service.resolve('nope')).toBeNull();
  });

  it('returns null for expired sessions without sliding them', async () => {
    const { service, repo } = makeService(activeSession(new Date(Date.now() - 1000)));
    expect(await service.resolve('whatever')).toBeNull();
    expect(repo.touch).not.toHaveBeenCalled();
  });

  it('resolves valid sessions and slides the expiry forward', async () => {
    const { service, repo } = makeService(activeSession());

    const resolved = await service.resolve('good-token');

    expect(resolved?.sessionId).toBe('session-1');
    expect(resolved?.user).toEqual(user);
    const [, newExpiry] = repo.touch.mock.calls[0]!;
    expect(newExpiry.getTime()).toBeGreaterThan(Date.now() + (SESSION_TTL_DAYS - 1) * 86_400_000);
  });
});

describe('SessionService.revoke', () => {
  it('delegates to the repository', async () => {
    const { service, repo } = makeService(null);
    await service.revoke('session-1');
    expect(repo.revoke).toHaveBeenCalledWith('session-1');
  });
});
