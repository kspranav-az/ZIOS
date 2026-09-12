import { apiFetch } from './api';

/**
 * Client for the Phase 14 multimodal analysis endpoints. Types mirror the
 * orchestrator's pydantic schema (services/ai-orchestrator/app/analysis/
 * schemas.py): feature JSON keeps snake_case keys exactly as stored.
 */

/** A single scalar measurement with validity metadata. */
export interface Measurement {
  value: number | null;
  valid: boolean;
  reason?: string | null;
  heuristic?: boolean;
}

export interface AnalysisJobSummary {
  id: string;
  kind: string;
  status: string;
  sessionId: string;
  questionId: string | null;
  schemaVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  media: unknown;
  metrics: unknown;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SessionAnalysisResult {
  sessionId: string;
  jobs: AnalysisJobSummary[];
}

/** Level-3 aggregate feature set for one interview media object. */
export interface InterviewFeatures {
  schema_version: string;
  session_id: string;
  question_id: string | null;
  media_kind: 'video' | 'audio';
  visual: Record<string, Measurement>;
  body: Record<string, Measurement>;
  hands: Record<string, Measurement>;
  speech: Record<string, Measurement>;
  voice: Record<string, Measurement>;
  interaction: Record<string, Measurement>;
  quality: Record<string, Measurement>;
}

export interface QuestionFeaturesResult {
  sessionId: string;
  questionId: string;
  analysisJobId: string;
  schemaVersion: string | null;
  features: InterviewFeatures;
  media: unknown;
  completedAt: string | null;
}

/**
 * Features for the latest completed analysis job of one question. Throws
 * ApiRequestError with statusCode 404 / code ANALYSIS_NOT_FOUND when no
 * completed analysis exists yet — callers should treat that as an empty
 * state, not an error.
 */
export async function getQuestionFeatures(
  sessionId: string,
  questionId: string,
): Promise<QuestionFeaturesResult> {
  return apiFetch<QuestionFeaturesResult>(
    `/analysis/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/features`,
  );
}

/** Lists all analysis jobs (any status) for a session. */
export async function getSessionAnalysis(sessionId: string): Promise<SessionAnalysisResult> {
  return apiFetch<SessionAnalysisResult>(`/analysis/sessions/${encodeURIComponent(sessionId)}`);
}
