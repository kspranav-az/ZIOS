import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiErrorResponse,
  consentByToken,
  getSession,
  NetworkError,
  requestCandidateOtp,
  resolveInviteByToken,
  startPreflight,
  submitTurn,
  verifyCandidateOtp,
} from './api';

const baseUrl = 'http://localhost:3000';

describe('API client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', baseUrl);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves an invite by token', async () => {
    const payload = {
      invite: {
        id: 'invite-1',
        status: 'invited',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      candidate: { id: 'candidate-1', email: 'alice@example.com' },
      kit: { id: 'kit-1', title: 'Engineer' },
      questions: [],
      otpRequired: false,
      otpVerified: false,
      session: null,
      consent: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      }),
    );

    const result = await resolveInviteByToken('raw-token');
    expect(result).toEqual(payload);
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/invites/by-token/raw-token`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws ApiErrorResponse with parsed error on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 410,
        statusText: 'Gone',
        json: async () => ({ statusCode: 410, code: 'INVITE_EXPIRED', message: 'Invite expired' }),
      }),
    );

    await expect(resolveInviteByToken('expired-token')).rejects.toBeInstanceOf(ApiErrorResponse);
    await expect(resolveInviteByToken('expired-token')).rejects.toMatchObject({
      statusCode: 410,
      code: 'INVITE_EXPIRED',
      message: 'Invite expired',
    });
  });

  it('falls back to status-based error when body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    await expect(resolveInviteByToken('bad-token')).rejects.toMatchObject({
      statusCode: 500,
      code: 'UNKNOWN_ERROR',
      message: 'Internal Server Error',
    });
  });

  it('retries once on network failure then throws NetworkError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveInviteByToken('network-token')).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends recovery token header for session-scoped calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          session: { id: 'session-1' },
          turn: { type: 'question', text: 'Hi?' },
        }),
      }),
    );

    await startPreflight('session-1', 'recovery-1');
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/sessions/session-1/preflight`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-recovery-token': 'recovery-1' }),
      }),
    );

    await submitTurn('session-1', 'recovery-1', { answer: 'answer' });
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/sessions/session-1/turn`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-recovery-token': 'recovery-1' }),
      }),
    );

    await getSession('session-1', 'recovery-1');
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/sessions/session-1`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-recovery-token': 'recovery-1' }),
      }),
    );
  });

  it('requests, verifies OTP and records consent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, expiresInSeconds: 600 }),
      }),
    );

    const otp = await requestCandidateOtp('token');
    expect(otp.ok).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ verified: true }),
      }),
    );
    const verified = await verifyCandidateOtp('token', { code: '123456' });
    expect(verified.verified).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          consent: { id: 'consent-1' },
          session: { id: 'session-1' },
          recoveryToken: 'recovery-1',
        }),
      }),
    );
    const consent = await consentByToken('token', { name: 'Alice', email: 'alice@example.com' });
    expect(consent.recoveryToken).toBe('recovery-1');
  });
});
