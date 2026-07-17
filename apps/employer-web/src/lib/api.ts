import type { ApiError } from '@zios/shared-types';

/**
 * Base URL of the api service. Build-time default points at the compose
 * stack published on the host; override with VITE_API_URL (see README).
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Error thrown for any non-2xx api response, carrying the ApiError envelope. */
export class ApiRequestError extends Error {
  readonly statusCode: number;
  /** Machine-readable code from the error envelope ('OTP_COOLDOWN', …). */
  readonly code: string;
  /** Extra envelope fields beyond statusCode/code/message (e.g. retryAfterSeconds). */
  readonly details: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Registered by the AuthProvider: any 401 from the api means the session is
 * gone (expired/revoked), so the app drops back to the signed-out state.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serializable request body. */
  json?: unknown;
}

/**
 * fetch wrapper for the api: always sends the httpOnly session cookie
 * (`credentials: 'include'` — the cookie IS the session; nothing is stored
 * in JS-reachable storage), parses the ApiError envelope on failure.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers, ...init } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 401) unauthorizedHandler?.();

  if (!response.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = `Request failed with status ${response.status}.`;
    let details: Record<string, unknown> = {};
    try {
      const body = (await response.json()) as Partial<ApiError> & Record<string, unknown>;
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.message === 'string') message = body.message;
      // Any extra envelope fields (e.g. retryAfterSeconds) ride along.
      details = Object.fromEntries(
        Object.entries(body).filter(
          ([key]) => key !== 'statusCode' && key !== 'code' && key !== 'message',
        ),
      );
    } catch {
      // Non-JSON error body — keep the defaults above.
    }
    throw new ApiRequestError(response.status, code, message, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
