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
