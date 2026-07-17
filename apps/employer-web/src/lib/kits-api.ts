import type {
  BankSearchResponse,
  CloneFromBankBody,
  CreateKitBody,
  CreateQuestionBody,
  DurationEstimateResponse,
  KitDetailResponse,
  KitListResponse,
  KitResponse,
  KitStatus,
  KitVersionListResponse,
  KitVersionResponse,
  PreviewResponse,
  PreviewTokenResponse,
  PublishKitResponse,
  QuestionListResponse,
  QuestionResponse,
  ReorderQuestionsBody,
  UpdateKitBody,
  UpdateKitSettingsBody,
  UpdateQuestionBody,
} from '@zios/shared-types';
import { apiFetch } from './api';

/**
 * Typed calls for the api's kits + question-bank endpoints (PRD E2/E4 — see
 * services/api/src/modules/kits/README.md for the autosave/optimistic-
 * concurrency contract this client speaks).
 */
export const kitsApi = {
  /* ---- kits ---- */
  list: (status?: KitStatus) =>
    apiFetch<KitListResponse>(status ? `/kits?status=${status}` : '/kits'),

  create: (body: CreateKitBody) => apiFetch<KitResponse>('/kits', { method: 'POST', json: body }),

  getDetail: (kitId: string) => apiFetch<KitDetailResponse>(`/kits/${kitId}`),

  update: (kitId: string, body: UpdateKitBody) =>
    apiFetch<KitResponse>(`/kits/${kitId}`, { method: 'PATCH', json: body }),

  updateSettings: (kitId: string, body: UpdateKitSettingsBody) =>
    apiFetch<KitResponse>(`/kits/${kitId}/settings`, { method: 'PATCH', json: body }),

  archive: (kitId: string) => apiFetch<KitResponse>(`/kits/${kitId}/archive`, { method: 'POST' }),

  unarchive: (kitId: string) =>
    apiFetch<KitResponse>(`/kits/${kitId}/unarchive`, { method: 'POST' }),

  publish: (kitId: string) =>
    apiFetch<PublishKitResponse>(`/kits/${kitId}/publish`, { method: 'POST' }),

  /* ---- versions (FR-E2-5) ---- */
  listVersions: (kitId: string) => apiFetch<KitVersionListResponse>(`/kits/${kitId}/versions`),

  getVersion: (kitId: string, version: number) =>
    apiFetch<KitVersionResponse>(`/kits/${kitId}/versions/${version}`),

  /* ---- duration estimate ---- */
  durationEstimate: (kitId: string) =>
    apiFetch<DurationEstimateResponse>(`/kits/${kitId}/duration-estimate`),

  /* ---- preview-as-candidate (FR-E2-6) ---- */
  createPreviewToken: (kitId: string) =>
    apiFetch<PreviewTokenResponse>(`/kits/${kitId}/preview-token`, { method: 'POST' }),

  getPreview: (token: string) => apiFetch<PreviewResponse>(`/preview/${token}`),

  /* ---- questions ---- */
  addQuestion: (kitId: string, body: CreateQuestionBody) =>
    apiFetch<QuestionResponse>(`/kits/${kitId}/questions`, { method: 'POST', json: body }),

  updateQuestion: (kitId: string, questionId: string, body: UpdateQuestionBody) =>
    apiFetch<QuestionResponse>(`/kits/${kitId}/questions/${questionId}`, {
      method: 'PATCH',
      json: body,
    }),

  deleteQuestion: (kitId: string, questionId: string) =>
    apiFetch<void>(`/kits/${kitId}/questions/${questionId}`, { method: 'DELETE' }),

  /** Full-order rebase: every question id of the kit exactly once. */
  reorderQuestions: (kitId: string, questionIds: string[]) =>
    apiFetch<QuestionListResponse>(`/kits/${kitId}/questions/reorder`, {
      method: 'POST',
      json: { questionIds } satisfies ReorderQuestionsBody,
    }),

  cloneFromBank: (kitId: string, body: CloneFromBankBody) =>
    apiFetch<QuestionResponse>(`/kits/${kitId}/questions/from-bank`, {
      method: 'POST',
      json: body,
    }),
};

export interface BankSearchFilters {
  query?: string;
  roleFamily?: string;
  topic?: string;
  type?: string;
  difficulty?: string;
  page?: number;
}

/** FR-E4-1: question-bank search (50 items/page, ILIKE + exact filters). */
export async function searchBank(filters: BankSearchFilters): Promise<BankSearchResponse> {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.roleFamily) params.set('role_family', filters.roleFamily);
  if (filters.topic) params.set('topic', filters.topic);
  if (filters.type) params.set('type', filters.type);
  if (filters.difficulty) params.set('difficulty', filters.difficulty);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const qs = params.toString();
  return apiFetch<BankSearchResponse>(`/bank/questions${qs ? `?${qs}` : ''}`);
}
