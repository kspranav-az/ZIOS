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
