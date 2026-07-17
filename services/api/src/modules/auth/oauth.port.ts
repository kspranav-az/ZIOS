import type { AuthResponse } from '@zios/shared-types';

export const OAUTH_PORT = Symbol('OAUTH_PORT');

export interface OAuthPort {
  /** Builds the URL to redirect the browser to the OAuth consent screen. */
  authorizationUrl(state: string, redirectUri: string): Promise<string> | string;

  /** Exchanges the authorization code returned by the provider for identity info. */
  exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ email: string; name: string; provider: string }>;
}

export interface OAuthCallbackResult extends AuthResponse {
  /** Provider that authenticated the user (e.g. google, mock). */
  provider: string;
}
