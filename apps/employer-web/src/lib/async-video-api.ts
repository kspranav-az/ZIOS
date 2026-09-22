import type { AnswerData } from '@zios/shared-types';
import { apiFetch } from './api';

export interface AsyncVideoReviewQuestion {
  id: string;
  prompt: string;
  topic: string;
  difficulty: string;
  rubricLines: Array<{ id: string; text: string; weight: number }>;
}

export interface AsyncVideoAnswer {
  id: string;
  questionId: string;
  questionPrompt: string;
  answerText: string | null;
  answerData: AnswerData | null;
  answeredAt: string | null;
}

export interface AsyncVideoReviewScore {
  id: string;
  sessionId: string;
  questionId: string;
  score: number | null;
  remarks: string | null;
  reviewedBy: string | null;
  source?: 'human' | 'ai_prefill';
  createdAt: string;
  updatedAt: string;
}

export interface AsyncVideoReviewDetail {
  candidate: { id: string; name: string; email: string };
  questions: AsyncVideoReviewQuestion[];
  answers: AsyncVideoAnswer[];
  scores: AsyncVideoReviewScore[];
}

export async function getAsyncVideoReview(sessionId: string): Promise<AsyncVideoReviewDetail> {
  return apiFetch<AsyncVideoReviewDetail>(
    `/async-video-interviews/${encodeURIComponent(sessionId)}/review`,
  );
}

export interface SubmitAsyncVideoScoreInput {
  score?: number;
  remarks?: string;
}

export async function submitAsyncVideoScore(
  sessionId: string,
  questionId: string,
  input: SubmitAsyncVideoScoreInput,
): Promise<AsyncVideoReviewScore> {
  return apiFetch<AsyncVideoReviewScore>(
    `/async-video-interviews/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/score`,
    { method: 'POST', json: input },
  );
}

export async function prefillAsyncVideoScorecard(
  sessionId: string,
): Promise<AsyncVideoReviewDetail> {
  return apiFetch<AsyncVideoReviewDetail>(
    `/async-video-interviews/${encodeURIComponent(sessionId)}/scorecard/prefill`,
    { method: 'POST' },
  );
}

export interface SubmitAsyncVideoScorecardInput {
  prefillAccepted?: boolean;
  editCount?: number;
}

export interface AsyncVideoScorecardResult {
  id: string;
  sessionId: string;
  status: string;
  overallRecommendation: number | null;
}

export async function submitAsyncVideoScorecard(
  sessionId: string,
  input: SubmitAsyncVideoScorecardInput,
): Promise<AsyncVideoScorecardResult> {
  return apiFetch<AsyncVideoScorecardResult>(
    `/async-video-interviews/${encodeURIComponent(sessionId)}/scorecard/submit`,
    { method: 'POST', json: input },
  );
}
