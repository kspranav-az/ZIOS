import type {
  ApiError,
  CandidateAccount,
  CandidateAuthResponse,
  CandidateMeResponse,
  CandidateProgressResponse,
  CandidateReadinessResponse,
  CandidateResumeResponse,
  CandidateWalletResponse,
  CandOtpRequestResponse,
  CoachingTip,
  EvaluationScore,
  EvidenceSpan,
  PracticeConsentBody,
  PracticeCreateBody,
  PracticeCreateResponse,
  PracticeFromJdBody,
  PracticeLibraryPack,
  PracticePreflightResponse,
  PracticeReport,
  PracticeSessionDetailResponse,
  PracticeTurnBody,
  PracticeTurnResponse,
  ResumeJdMatchResponse,
  SessionTranscript,
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
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth && getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        ...extraHeaders,
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

export type {
  CandidateAccount,
  CandidateProgressResponse,
  CandidateReadinessResponse,
  CandidateWalletResponse,
};

/* ---- practice engine (Phase 12, D5) ---- */

export interface PracticeLibraryResponse {
  packs: PracticeLibraryPack[];
  consent: { version: string; text: string };
}

export interface PracticeReportDetail {
  report: PracticeReport | null;
  scores: EvaluationScore[];
  evidenceSpans: EvidenceSpan[];
  transcript: SessionTranscript[];
  coachingTips: CoachingTip[];
}

export function fetchPracticeLibrary(): Promise<PracticeLibraryResponse> {
  return request('GET', '/cand/practice/library', undefined, true);
}

export function createPractice(body: PracticeCreateBody): Promise<PracticeCreateResponse> {
  return request('POST', '/cand/practice', body, true);
}

export function fetchPracticeSession(sessionId: string): Promise<PracticeSessionDetailResponse> {
  return request('GET', `/cand/practice/${sessionId}`, undefined, true);
}

export function consentPractice(
  sessionId: string,
  body: PracticeConsentBody,
): Promise<{ session: unknown }> {
  return request('POST', `/cand/practice/${sessionId}/consent`, body, true);
}

export function preflightPractice(
  sessionId: string,
  recoveryToken: string,
): Promise<PracticePreflightResponse> {
  return request(
    'POST',
    `/cand/practice/${sessionId}/preflight`,
    {},
    true,
    recoveryToken ? { 'x-recovery-token': recoveryToken } : undefined,
  );
}

export function submitPracticeTurn(
  sessionId: string,
  recoveryToken: string,
  body: PracticeTurnBody,
): Promise<PracticeTurnResponse> {
  return request(
    'POST',
    `/cand/practice/${sessionId}/turn`,
    body,
    true,
    recoveryToken ? { 'x-recovery-token': recoveryToken } : undefined,
  );
}

export function fetchPracticeReport(sessionId: string): Promise<PracticeReportDetail> {
  return request('GET', `/cand/practice/${sessionId}/report`, undefined, true);
}

export function fetchWallet(): Promise<CandidateWalletResponse> {
  return request('GET', '/cand/wallet', undefined, true);
}

/* ---- progress + readiness (Phase 12, Branch 5, D14/D15) ---- */

export function fetchProgress(): Promise<CandidateProgressResponse> {
  return request('GET', '/cand/practice/progress', undefined, true);
}

export function fetchReadiness(): Promise<CandidateReadinessResponse> {
  return request('GET', '/cand/practice/readiness', undefined, true);
}

/* ---- resume intelligence (Phase 12, D10) ---- */

export function uploadResume(body: {
  fileName: string;
  contentBase64: string;
  text?: string;
}): Promise<CandidateResumeResponse> {
  return request('POST', '/cand/resume', body, true);
}

export function fetchResume(): Promise<CandidateResumeResponse> {
  return request('GET', '/cand/resume', undefined, true);
}

export function deleteResume(): Promise<{ ok: true }> {
  return request('DELETE', '/cand/resume', undefined, true);
}

export function matchResume(jdText: string): Promise<ResumeJdMatchResponse> {
  return request('POST', '/cand/resume/match', { jdText }, true);
}

export function createPracticeFromJd(body: PracticeFromJdBody): Promise<PracticeCreateResponse> {
  return request('POST', '/cand/practice/from-jd', body, true);
}

/* ---- practice recovery token (tab-scoped like the auth token, D12) ---- */

const recoveryKey = (sessionId: string) => `ascend_practice_recovery:${sessionId}`;

export function storePracticeRecovery(sessionId: string, recoveryToken: string): void {
  sessionStorage.setItem(recoveryKey(sessionId), recoveryToken);
}

export function loadPracticeRecovery(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(recoveryKey(sessionId));
  } catch {
    return null;
  }
}

export function clearPracticeRecovery(sessionId: string): void {
  sessionStorage.removeItem(recoveryKey(sessionId));
}
