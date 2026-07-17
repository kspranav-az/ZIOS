/**
 * Types shared across services and apps. Keep this package dependency-free:
 * pure type declarations and const enums only, no runtime logic.
 */

/** Standard liveness response returned by every service's GET /healthz. */
export interface HealthResponse {
  status: 'ok';
  service: string;
}

/** Employer-side roles (PRD FR-E1-2). Mirrors the app_user.role check constraint. */
export type AppUserRole = 'admin' | 'interviewer';

export interface Org {
  id: string;
  name: string;
  plan: string;
  creditsBalance: number;
  createdAt: string;
}

export interface AppUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: AppUserRole;
  createdAt: string;
}

/* --------------------------------------------------------------------------
 * Phase 01 — auth (email+OTP) and org/invite REST contracts.
 * The api returns exactly these shapes; error responses use ApiError.
 * ------------------------------------------------------------------------ */

/** Uniform error envelope for non-2xx responses from the api. */
export interface ApiError {
  statusCode: number;
  /** Machine-readable, stable code for client branching (e.g. 'OTP_COOLDOWN'). */
  code: string;
  message: string;
}

export interface OtpRequestBody {
  email: string;
}

export interface OtpRequestResponse {
  ok: true;
  /** Lifetime of the issued code (600). */
  expiresInSeconds: number;
  /** Minimum wait before another code can be requested (60). */
  resendAvailableInSeconds: number;
}

export interface OtpVerifyBody {
  email: string;
  /** 6-digit code delivered by email. */
  code: string;
}

export interface AuthSessionInfo {
  /** Opaque bearer token; also set as an httpOnly cookie (`zios_session`). */
  token: string;
  /** ISO 8601; sliding — every authenticated request extends it by 30d. */
  expiresAt: string;
}

export interface AuthResponse {
  session: AuthSessionInfo;
  /** True when this login auto-created the org + admin user (first signup). */
  isNewUser: boolean;
  user: AppUser;
  org: Org;
}

export interface MeResponse {
  user: AppUser;
  org: Org;
}

export interface OrgInvite {
  id: string;
  orgId: string;
  email: string;
  role: AppUserRole;
  expiresAt: string;
  createdAt: string;
}

export interface CreateInviteBody {
  email: string;
  role: AppUserRole;
}

/** The raw invite token is only ever sent to the invitee's email, never here. */
export interface CreateInviteResponse {
  invite: OrgInvite;
}

export interface AcceptInviteBody {
  /** Raw token from the invite email link. */
  token: string;
}

/** Returned by POST /orgs/current/invites/accept — the caller's new org context. */
export interface AcceptInviteResponse {
  user: AppUser;
  org: Org;
}

export interface MembersResponse {
  members: AppUser[];
}

/* --------------------------------------------------------------------------
 * Phase 02 — Interview Kit Builder & Question Bank contracts
 * (PRD E2 FR-E2-1…E2-6, E4 FR-E4-1/E4-3, §6.2, §9).
 * The api returns exactly these shapes; error responses use ApiError with the
 * codes listed in services/api/src/modules/kits/README.md.
 * ------------------------------------------------------------------------ */

export type KitStatus = 'draft' | 'published' | 'archived';
export type InterviewMode = 'text' | 'voice' | 'video';
export type ProctoringLevel = 'none' | 'standard' | 'strict';
/** §6.2 question type matrix. rating_scale is always a fixed 1–5 scale. */
export type QuestionType = 'open_ended' | 'mcq_single' | 'mcq_multi' | 'rating_scale';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type TimeLimitType = 'soft' | 'hard';
/** adaptive_ai is only valid on open_ended questions and requires a depth cap 1–3 (FR-E2-4). */
export type FollowupPolicy = 'none' | 'fixed' | 'adaptive_ai';
/** FR-E4-3 provenance: every question records where it came from. */
export type QuestionSource = 'manual' | 'jd_generated' | 'bank' | 'external_api';

export interface KitSettings {
  mode: InterviewMode;
  /** BCP-47-ish free text for M1 (e.g. 'en'); UI copy is English-only in M1. */
  language: string;
  proctoringLevel: ProctoringLevel;
  introText: string | null;
  outroText: string | null;
  logoUrl: string | null;
  /** Server-enforced publish ceiling for the duration estimate (seconds). */
  totalTimeCapSec: number;
}

export interface Kit {
  id: string;
  orgId: string;
  title: string;
  role: string | null;
  level: string | null;
  status: KitStatus;
  settings: KitSettings;
  jdRef: string | null;
  createdBy: string;
  createdAt: string;
  /**
   * Optimistic-concurrency token. Read it from any response, send it back as
   * `expectedUpdatedAt` on kit PATCHes; a mismatch answers 409 STALE_WRITE.
   */
  updatedAt: string;
}

export interface RubricLine {
  /** Stable per-question id; frozen into version snapshots for evidence linking (E10). */
  id: string;
  text: string;
  /** 0 < weight ≤ 1; publish requires the per-question weights to sum to 1 (±0.01). */
  weight: number;
}

export interface McqOption {
  id: string;
  text: string;
  /** Scoring key for deterministic MCQ scoring later (§6.2); optional while authoring. */
  correct?: boolean;
}

export interface KitQuestion {
  id: string;
  kitId: string;
  topic: string;
  /** Fractional-index key; questions are always returned ordered by it. Never edit directly — use reorder. */
  position: string;
  type: QuestionType;
  prompt: string;
  /** Present only for mcq_single/mcq_multi (≥ 2 entries); null otherwise. */
  options: McqOption[] | null;
  difficulty: QuestionDifficulty;
  /** Null = the duration estimator assumes the default (120s). */
  timeLimitSec: number | null;
  timeLimitType: TimeLimitType;
  mandatory: boolean;
  followupPolicy: FollowupPolicy;
  /** Author-written follow-up prompts; present only when followupPolicy = 'fixed'. */
  followupFixed: string[] | null;
  /** 1–3; present only when followupPolicy = 'adaptive_ai'. */
  followupDepthCap: number | null;
  rubricLines: RubricLine[];
  source: QuestionSource;
  /** e.g. the question_bank_item id when source = 'bank' (FR-E4-3). */
  sourceRef: string | null;
  createdAt: string;
  /** Per-question optimistic-concurrency token (same contract as Kit.updatedAt). */
  updatedAt: string;
}

/* ---- frozen versions (FR-E2-5) ---- */

export interface KitSnapshotKit {
  id: string;
  title: string;
  role: string | null;
  level: string | null;
  settings: KitSettings;
  jdRef: string | null;
}

/** The immutable definition frozen at publish time. */
export interface KitSnapshot {
  schemaVersion: 1;
  kit: KitSnapshotKit;
  /** Full question definitions in display order. */
  questions: KitQuestion[];
  durationEstimateSec: number;
}

export interface KitVersionSummary {
  id: string;
  kitId: string;
  version: number;
  publishedBy: string;
  publishedAt: string;
}

export interface KitVersion extends KitVersionSummary {
  snapshot: KitSnapshot;
}

/* ---- request/response bodies ---- */

export interface CreateKitBody {
  title: string;
  role?: string;
  level?: string;
  settings?: Partial<KitSettings>;
}

export interface KitResponse {
  kit: Kit;
}

export interface KitListResponse {
  kits: Kit[];
}

/** GET /kits/:id — the builder's working document. */
export interface KitDetailResponse {
  kit: Kit;
  questions: KitQuestion[];
  /** Distinct topics in order of first appearance (derived from questions). */
  topics: string[];
}

export interface UpdateKitBody {
  title?: string;
  role?: string | null;
  level?: string | null;
  expectedUpdatedAt?: string;
}

export type UpdateKitSettingsBody = Partial<KitSettings> & { expectedUpdatedAt?: string };

export interface CreateQuestionBody {
  type: QuestionType;
  prompt: string;
  topic?: string;
  options?: McqOption[];
  difficulty?: QuestionDifficulty;
  timeLimitSec?: number | null;
  timeLimitType?: TimeLimitType;
  mandatory?: boolean;
  followupPolicy?: FollowupPolicy;
  followupFixed?: string[];
  followupDepthCap?: number;
  rubricLines?: RubricLine[];
  /** Insert before this question id; omitted = append to the end. */
  beforeQuestionId?: string;
}

export interface UpdateQuestionBody {
  topic?: string;
  type?: QuestionType;
  prompt?: string;
  options?: McqOption[] | null;
  difficulty?: QuestionDifficulty;
  timeLimitSec?: number | null;
  timeLimitType?: TimeLimitType;
  mandatory?: boolean;
  followupPolicy?: FollowupPolicy;
  followupFixed?: string[] | null;
  followupDepthCap?: number | null;
  rubricLines?: RubricLine[];
  expectedUpdatedAt?: string;
}

export interface QuestionResponse {
  question: KitQuestion;
}

export interface QuestionListResponse {
  questions: KitQuestion[];
}

/** Full-order rebase: must list every question id of the kit exactly once. */
export interface ReorderQuestionsBody {
  questionIds: string[];
}

export interface RenameTopicBody {
  from: string;
  to: string;
}

export interface RenameTopicResponse {
  updated: number;
}

export interface CloneFromBankBody {
  bankItemId: string;
  /** Overrides the bank item's topic when provided. */
  topic?: string;
}

export interface PublishKitResponse {
  version: KitVersionSummary;
}

/** 422 PUBLISH_VALIDATION_FAILED carries this extra field. */
export interface PublishValidationError extends ApiError {
  details: string[];
}

export interface KitVersionListResponse {
  versions: KitVersionSummary[];
}

export interface KitVersionResponse {
  version: KitVersion;
}

export interface DurationEstimateResponse {
  kitId: string;
  questionCount: number;
  /** Sum of per-question limits (null → 120s default), before overhead. */
  baseSeconds: number;
  /** baseSeconds × 1.2 overhead, rounded — the number publish compares to the cap. */
  estimatedSeconds: number;
  capSeconds: number;
  withinCap: boolean;
  perQuestion: Array<{ questionId: string; seconds: number }>;
}

/* ---- preview-as-candidate (FR-E2-6) ---- */

export interface PreviewTokenResponse {
  token: string;
  /** Always 1800 (30 minutes). */
  expiresInSeconds: number;
  expiresAt: string;
}

/**
 * Read-only projection of the current draft. Creates no session/persistence
 * rows. Employer-internal: rubric lines are included; `preview: true` marks it.
 */
export interface PreviewResponse {
  preview: true;
  kit: KitSnapshotKit;
  questions: KitQuestion[];
  durationEstimateSec: number;
}

/* ---- question bank (FR-E4-1) ---- */

export interface QuestionBankItem {
  id: string;
  roleFamily: string;
  topic: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  prompt: string;
  options: McqOption[] | null;
  rubricLines: RubricLine[];
  tags: string[];
  createdAt: string;
}

/** GET /bank/questions?query=&role_family=&topic=&type=&difficulty=&tag=&page= */
export interface BankSearchResponse {
  items: QuestionBankItem[];
  page: number;
  /** Fixed 50. */
  pageSize: number;
  total: number;
  totalPages: number;
}

/* --------------------------------------------------------------------------
 * Phase 03 — Invites, Consent Registry & Candidate Text Interview Sessions
 * (PRD E5, E6 text mode, E7, §10 state machine).
 * ------------------------------------------------------------------------ */

export type InviteStatus = 'invited' | 'started' | 'completed' | 'expired';

export type SessionStatus =
  | 'invited'
  | 'consented'
  | 'preflight'
  | 'live'
  | 'completed'
  | 'abandoned'
  | 'scoring'
  | 'reported'
  | 'reviewed';

export type SessionConductor = 'ai' | 'human';

/** The stub conductor's next output in text mode. */
export type TurnType = 'question' | 'followup' | 'wrapup';

export interface Candidate {
  id: string;
  orgId: string;
  name: string;
  email: string;
  phone: string | null;
  externalRef: string | null;
  piiVaultRef: string | null;
  createdAt: string;
}

export interface Invite {
  id: string;
  orgId: string;
  kitVersionId: string;
  candidateId: string;
  /** SHA-256 of the single-use token delivered to the candidate. */
  tokenHash: string;
  expiresAt: string;
  otpRequired: boolean;
  otpVerifiedAt: string | null;
  status: InviteStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentRecord {
  id: string;
  sessionId: string | null;
  inviteId: string | null;
  subjectId: string;
  purpose: string;
  noticeVersion: string;
  capturedAt: string;
  artifactUri: string | null;
  withdrawnAt: string | null;
}

export interface InterviewSession {
  id: string;
  inviteId: string;
  kitVersionId: string;
  mode: InterviewMode;
  conductor: SessionConductor;
  status: SessionStatus;
  consentId: string | null;
  preflightReport: Record<string, unknown>;
  startedAt: string | null;
  endedAt: string | null;
  mediaRefs: unknown[];
  integrityEvents: unknown[];
  schemaVersion: number;
  recoveryTokenHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTranscript {
  id: string;
  sessionId: string;
  questionId: string;
  questionPrompt: string;
  answerText: string | null;
  position: number;
  evidenceSpan: Array<{ start: number; end: number; transcriptId: string }>;
  createdAt: string;
  answeredAt: string | null;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface SessionTurnResponse {
  type: TurnType;
  text: string;
  questionId: string | null;
}

/* ---- invites ---- */

export interface InviteCandidateInput {
  name: string;
  email: string;
  phone?: string;
  externalRef?: string;
}

export interface CreateCandidateInviteBody {
  kitVersionId: string;
  candidate: InviteCandidateInput;
  /** Default 7 days. */
  expiresInDays?: number;
  otpRequired?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateCandidateInviteResponse {
  invite: Invite;
  candidate: Candidate;
  /** Raw token — delivered to the candidate, never stored. */
  token: string;
}

export interface BulkInviteRowResult {
  row: number;
  invite?: Invite;
  candidate?: Candidate;
  token?: string;
  error?: string;
}

export interface BulkInviteResponse {
  total: number;
  successes: number;
  errors: number;
  results: BulkInviteRowResult[];
}

export interface ReissueInviteBody {
  /** If omitted, the existing expiry is preserved and only the token rotates. */
  expiresInDays?: number;
}

export interface RescheduleInviteBody {
  /** New absolute expiry. Takes precedence over extendDays. */
  expiresAt?: string;
  /** Extend from now by this many days. */
  extendDays?: number;
}

export interface InviteListResponse {
  invites: Invite[];
}

export interface InviteDetailResponse {
  invite: Invite;
  candidate: Candidate;
  kitVersion: KitVersionSummary;
}

/* ---- public token / consent / OTP ---- */

export interface TokenResolveResponse {
  invite: Invite;
  candidate: Candidate;
  kit: KitSnapshotKit;
  questions: KitQuestion[];
  otpRequired: boolean;
  otpVerified: boolean;
  /** Present when the candidate has already started a session. */
  session: InterviewSession | null;
  consent: ConsentRecord | null;
}

export interface CandidateOtpRequestResponse {
  ok: true;
  expiresInSeconds: number;
}

export interface CandidateOtpVerifyBody {
  code: string;
}

export interface CandidateOtpVerifyResponse {
  verified: true;
}

export interface ConsentByTokenBody {
  /** Candidate confirms the identity bound to the invite. */
  name?: string;
  email?: string;
  phone?: string;
}

export interface ConsentByTokenResponse {
  consent: ConsentRecord;
  session: InterviewSession;
  /** Used to resume the session without re-typing the invite link. */
  recoveryToken: string;
}

/* ---- generic consent registry ---- */

export interface CreateConsentBody {
  subjectId: string;
  purpose: string;
  noticeVersion: string;
  artifactUri?: string;
  inviteId?: string;
  sessionId?: string;
}

export interface ConsentResponse {
  consent: ConsentRecord;
}

/* ---- sessions ---- */

export interface PreflightBody {
  /** Client-reported preflight results; stored as telemetry, not gating. */
  report?: Record<string, unknown>;
}

export interface PreflightResponse {
  session: InterviewSession;
  turn: SessionTurnResponse;
}

export interface TurnBody {
  /** Candidate's answer to the question just asked. Omit on first turn / resume. */
  answer?: string;
}

export interface TurnResponse {
  session: InterviewSession;
  turn: SessionTurnResponse;
}

export interface SessionDetailResponse {
  session: InterviewSession;
  transcript: SessionTranscript[];
  events: SessionEvent[];
}

/* --------------------------------------------------------------------------
 * Phase 04 — Evaluation Pipeline, Reports, Share Links & Dashboard
 * (PRD E8 FR-E8-1…E8-6, E9 FR-E9-1/E9-2, §11 evidence-linked scoring).
 * ------------------------------------------------------------------------ */

export type EvaluationStatus = 'pending' | 'completed' | 'failed';

export interface CommunicationMetrics {
  /** Approximate words per minute across all answered transcript rows. */
  paceWpm: number;
  /** Count of filler words (um, uh, like) across answers. */
  fillerCount: number;
  /** Number of paragraph breaks across answers. */
  paragraphCount: number;
  /** Average sentence length in words. */
  avgSentenceLength: number;
}

export interface EvaluationReport {
  id: string;
  orgId: string;
  sessionId: string;
  inviteId: string | null;
  kitVersionId: string;
  status: EvaluationStatus;
  overallRecommendation: number | null;
  overallConfidence: number | null;
  communicationMetrics: CommunicationMetrics;
  rubricVersion: string;
  modelRoute: string;
  promptVersions: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationScore {
  id: string;
  reportId: string;
  questionId: string;
  criterionId: string;
  criterionText: string;
  score: number;
  weight: number;
  evidenceSpanIds: string[];
}

export interface EvidenceSpan {
  id: string;
  reportId: string;
  transcriptId: string | null;
  questionId: string;
  start: number;
  end: number;
  quoteText: string;
}

export interface ScoreOverride {
  id: string;
  reportId: string;
  scoreId: string;
  originalScore: number;
  newScore: number;
  reasonCode: string;
  reasonText: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ReportShareLink {
  id: string;
  reportId: string;
  tokenHash: string;
  expiresAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
}

export interface PipelineStage {
  name: string;
  status: 'ok' | 'error';
  ms: number;
  detail?: Record<string, unknown>;
}

export interface PipelineLog {
  id: string;
  sessionId: string | null;
  reportId: string | null;
  stages: PipelineStage[];
  totalMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

/* ---- request/response bodies ---- */

export interface OverrideScoreBody {
  newScore: number;
  reasonCode: string;
  reasonText?: string;
}

export interface CreateShareLinkBody {
  /** TTL in hours; defaults to 168 (7 days). */
  expiresInHours?: number;
}

export interface CreateShareLinkResponse {
  link: ReportShareLink & { token: string };
}

export interface ReportListQuery {
  status?: EvaluationStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ReportListItem {
  report: EvaluationReport;
  candidate: Candidate;
  kitTitle: string;
}

export interface ReportListResponse {
  reports: ReportListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReportDetailResponse {
  report: EvaluationReport;
  scores: EvaluationScore[];
  evidenceSpans: EvidenceSpan[];
  overrides: ScoreOverride[];
  transcript: SessionTranscript[];
}

export interface DashboardInterviewItem {
  session: InterviewSession;
  candidate: Candidate;
  kitTitle: string;
  reportStatus: EvaluationStatus | null;
  overallRecommendation: number | null;
  flags: string[];
}

export interface DashboardListResponse {
  items: DashboardInterviewItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicReportResponse {
  report: EvaluationReport;
  scores: EvaluationScore[];
  evidenceSpans: EvidenceSpan[];
  transcript: SessionTranscript[];
}
