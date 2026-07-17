import { describe, expect, it } from 'vitest';
import { MockOAuthAdapter } from './mock-oauth.adapter';

describe('MockOAuthAdapter', () => {
  it('returns a local redirect URL containing state and code', () => {
    const adapter = new MockOAuthAdapter();
    const url = adapter.authorizationUrl('state-123', 'http://localhost:3000/auth/google/callback');
    expect(url).toContain('code=mock-oauth-code-ok');
    expect(url).toContain('state=state-123');
  });

  it('exchanges a valid code for a mock identity', async () => {
    const adapter = new MockOAuthAdapter();
    const identity = await adapter.exchangeCode('mock-oauth-code-ok', 'http://localhost/cb');
    expect(identity.email).toBe('mock.user@example.com');
    expect(identity.provider).toBe('mock');
  });

  it('rejects an invalid code', async () => {
    const adapter = new MockOAuthAdapter();
    await expect(adapter.exchangeCode('bad-code', 'http://localhost/cb')).rejects.toThrow(
      'invalid mock oauth code',
    );
  });
});
