import { Injectable } from '@nestjs/common';
import type { OAuthPort } from './oauth.port';

/**
 * Fixture-driven OAuth adapter for local development and mock-credential CI.
 * The "authorization URL" points back at the application's own callback with
 * a deterministic code so no external provider is needed.
 */
@Injectable()
export class MockOAuthAdapter implements OAuthPort {
  authorizationUrl(state: string, redirectUri: string): string {
    const url = new URL(redirectUri);
    url.searchParams.set('code', 'mock-oauth-code-ok');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(
    code: string,
    _redirectUri: string,
  ): Promise<{ email: string; name: string; provider: string }> {
    if (code !== 'mock-oauth-code-ok') {
      throw new Error('invalid mock oauth code');
    }
    return {
      email: 'mock.user@example.com',
      name: 'Mock User',
      provider: 'mock',
    };
  }
}
