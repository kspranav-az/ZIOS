import type {
  AnswerData,
  ApiError,
  CandidateOtpRequestResponse,
  CandidateOtpVerifyBody,
  CandidateOtpVerifyResponse,
  ConsentByTokenBody,
  ConsentByTokenResponse,
  IntegrityEventBody,
  IntegrityFlagsResponse,
  InterviewSession,
  KitQuestion,
  LiveTokenResponse,
  PreflightBody,
  PreflightResponse,
  SessionDetailResponse,
  TokenResolveResponse,
  TurnBody,
  TurnResponse,
  VoiceFallbackBody,
  VoiceFallbackResponse,
  VoiceTokenResponse,
} from '@zios/shared-types';

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
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    retry?: boolean;
  } = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (options.retry !== false) {
      return request<T>(method, path, { ...options, retry: false });
    }
    throw new NetworkError(error);
  }

  if (!response.ok) {
    let errorBody: ApiError;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      errorBody = {
        statusCode: response.status,
        code: 'UNKNOWN_ERROR',
        message: response.statusText || 'An unexpected error occurred',
      };
    }
    throw new ApiErrorResponse(errorBody, response);
  }

  return response.json() as Promise<T>;
}

export function resolveInviteByToken(token: string): Promise<TokenResolveResponse> {
  return request<TokenResolveResponse>('GET', `/invites/by-token/${encodeURIComponent(token)}`);
}

export function requestCandidateOtp(token: string): Promise<CandidateOtpRequestResponse> {
  return request<CandidateOtpRequestResponse>(
    'POST',
    `/invites/by-token/${encodeURIComponent(token)}/otp/request`,
    { body: {} },
  );
}

export function verifyCandidateOtp(
  token: string,
  body: CandidateOtpVerifyBody,
): Promise<CandidateOtpVerifyResponse> {
  return request<CandidateOtpVerifyResponse>(
    'POST',
    `/invites/by-token/${encodeURIComponent(token)}/otp/verify`,
    { body },
  );
}

export function consentByToken(
  token: string,
  body: ConsentByTokenBody,
): Promise<ConsentByTokenResponse> {
  return request<ConsentByTokenResponse>(
    'POST',
    `/invites/by-token/${encodeURIComponent(token)}/consent`,
    { body },
  );
}

export function recordIntegrityEvents(
  sessionId: string,
  body: IntegrityEventBody,
): Promise<IntegrityFlagsResponse> {
  return request<IntegrityFlagsResponse>(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/integrity/events`,
    { body },
  );
}

export function startPreflight(
  sessionId: string,
  recoveryToken: string,
  body: PreflightBody = {},
): Promise<PreflightResponse> {
  return request<PreflightResponse>(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/preflight`,
    {
      body,
      headers: { 'x-recovery-token': recoveryToken },
    },
  );
}

export function submitTurn(
  sessionId: string,
  recoveryToken: string,
  body: TurnBody,
): Promise<TurnResponse> {
  return request<TurnResponse>('POST', `/sessions/${encodeURIComponent(sessionId)}/turn`, {
    body,
    headers: { 'x-recovery-token': recoveryToken },
  });
}

export function getSession(
  sessionId: string,
  recoveryToken: string,
): Promise<SessionDetailResponse> {
  return request<SessionDetailResponse>('GET', `/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { 'x-recovery-token': recoveryToken },
  });
}

export function getVoiceToken(
  sessionId: string,
  recoveryToken: string,
): Promise<VoiceTokenResponse> {
  return request<VoiceTokenResponse>(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/voice/token`,
    { headers: { 'x-recovery-token': recoveryToken } },
  );
}

export function fallbackToText(
  sessionId: string,
  recoveryToken: string,
  body: VoiceFallbackBody,
): Promise<VoiceFallbackResponse> {
  return request<VoiceFallbackResponse>(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/voice/fallback`,
    { body, headers: { 'x-recovery-token': recoveryToken } },
  );
}

export function getLiveToken(sessionId: string, recoveryToken: string): Promise<LiveTokenResponse> {
  return request<LiveTokenResponse>(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/live/token`,
    { headers: { 'x-recovery-token': recoveryToken } },
  );
}

/* ---- async video interviews ---- */

export interface AsyncVideoConsentBody {
  name?: string;
  email?: string;
  phone?: string;
  noticeText?: string;
}

export interface AsyncVideoConsentResponse {
  session: InterviewSession;
  recoveryToken: string;
}

export interface AsyncVideoAnswer {
  id: string;
  sessionId: string;
  questionId: string;
  questionPrompt: string;
  answerText: string | null;
  answerData: AnswerData | null;
  position: number;
  answeredAt: string | null;
}

export interface AsyncVideoQuestionsResponse {
  session: InterviewSession;
  questions: KitQuestion[];
  answers: AsyncVideoAnswer[];
  maxDurationSec: number;
}

export interface AsyncVideoUploadResponse {
  transcriptId: string;
  recordingUri: string;
  checksum: string;
  transcript?: string;
}

export function asyncConsentByToken(
  token: string,
  body: AsyncVideoConsentBody,
): Promise<AsyncVideoConsentResponse> {
  return request<AsyncVideoConsentResponse>(
    'POST',
    `/async-video-interviews/by-token/${encodeURIComponent(token)}/consent`,
    { body },
  );
}

export function getAsyncVideoQuestions(
  sessionId: string,
  recoveryToken: string,
): Promise<AsyncVideoQuestionsResponse> {
  return request<AsyncVideoQuestionsResponse>(
    'GET',
    `/async-video-interviews/${encodeURIComponent(sessionId)}/questions`,
    { headers: { 'x-recovery-token': recoveryToken } },
  );
}

export async function uploadAsyncVideoAnswer(
  sessionId: string,
  questionId: string,
  recoveryToken: string,
  videoBlob: Blob,
  durationSec?: number,
): Promise<AsyncVideoUploadResponse> {
  const form = new FormData();
  form.append('video', videoBlob, 'answer.webm');
  if (durationSec !== undefined) {
    form.append('durationSec', String(durationSec));
  }

  const response = await fetch(
    `${API_BASE}/async-video-interviews/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/video`,
    {
      method: 'POST',
      headers: { 'x-recovery-token': recoveryToken },
      body: form,
    },
  );

  if (!response.ok) {
    let errorBody: ApiError;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      errorBody = {
        statusCode: response.status,
        code: 'UNKNOWN_ERROR',
        message: response.statusText || 'An unexpected error occurred',
      };
    }
    throw new ApiErrorResponse(errorBody, response);
  }

  return response.json() as Promise<AsyncVideoUploadResponse>;
}
