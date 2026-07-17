import type {
  AcceptInviteResponse,
  AuthResponse,
  CreateInviteBody,
  CreateInviteResponse,
  MeResponse,
  OtpRequestResponse,
} from '@zios/shared-types';
import { apiFetch } from './api';

/** Typed calls for the api's auth + org endpoints (see services/api auth README). */
export const authApi = {
  requestOtp: (email: string) =>
    apiFetch<OtpRequestResponse>('/auth/otp/request', { method: 'POST', json: { email } }),

  verifyOtp: (email: string, code: string) =>
    apiFetch<AuthResponse>('/auth/otp/verify', { method: 'POST', json: { email, code } }),

  me: () => apiFetch<MeResponse>('/auth/me'),

  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),

  acceptInvite: (token: string) =>
    apiFetch<AcceptInviteResponse>('/orgs/current/invites/accept', {
      method: 'POST',
      json: { token },
    }),

  createInvite: (body: CreateInviteBody) =>
    apiFetch<CreateInviteResponse>('/orgs/current/invites', { method: 'POST', json: body }),
};
