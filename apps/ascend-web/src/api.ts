import type {
  ApiError,
  CandidateAccount,
  CandidateAuthResponse,
  CandidateMeResponse,
  CandOtpRequestResponse,
} from '@zios/shared-types';
import { getToken } from './auth';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export class ApiErrorResponse extends Error {
  public readonly error: ApiError;
  public readonly response: Response;

  constructor(error: ApiError, response: Response) {
    super(error.message);
    this.name = 'ApiErrorResponse';
    this.error = error;
    this.response = response;
  }

  get statusCode(): number {
    return this.error.statusCode;
  }

  get code(): string {
    return this.error.code;
  }
}

export class NetworkError extends Error {
  public readonly networkCause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Network error');
    this.name = 'NetworkError';
    this.networkCause = cause;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  auth = false,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth && getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }
  if (!res.ok) {
    let error: ApiError = {
      statusCode: res.status,
      code: 'UNKNOWN',
      message: `Request failed with ${res.status}`,
    };
    try {
      error = (await res.json()) as ApiError;
    } catch {
      // keep the fallback error shape
    }
    throw new ApiErrorResponse(error, res);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function requestOtp(email: string): Promise<CandOtpRequestResponse> {
  return request('POST', '/cand/auth/otp/request', { email });
}

export function verifyOtp(email: string, code: string): Promise<CandidateAuthResponse> {
  return request('POST', '/cand/auth/otp/verify', { email, code });
}

export function logout(): Promise<void> {
  return request('POST', '/cand/auth/logout', undefined, true);
}

export function fetchMe(): Promise<CandidateMeResponse> {
  return request('GET', '/cand/me', undefined, true);
}

export function patchMe(patch: {
  name?: string;
  targetRole?: string;
  marketingOptIn?: boolean;
}): Promise<CandidateMeResponse> {
  return request('PATCH', '/cand/me', patch, true);
}

export type { CandidateAccount };
