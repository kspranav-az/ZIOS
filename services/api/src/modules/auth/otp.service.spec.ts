import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '@/modules/database';
import type { EmailSender } from '@/modules/notifications';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS } from './auth.constants';
import { OtpRepository, type OtpRow } from './otp.repository';
import { OtpService } from './otp.service';

function hashOf(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

function otpRow(overrides: Partial<OtpRow> = {}): OtpRow {
  return {
    id: 'otp-1',
    email: 'user@example.com',
    code_hash: hashOf('salt-1', '123456'),
    salt: 'salt-1',
    attempts: 0,
    expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    consumed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

function makeService(rowFromFindLatest: OtpRow | null = null) {
  const otps = {
    findLatest: vi.fn(async () => rowFromFindLatest),
    insert: vi.fn(async (input: { email: string; codeHash: string; salt: string }) =>
      otpRow({ code_hash: input.codeHash, salt: input.salt }),
    ),
    consumeAllForEmail: vi.fn(async () => {}),
    incrementAttempts: vi.fn(async () => {}),
    markConsumed: vi.fn(async () => {}),
  };
  const db = { transaction: vi.fn(async (fn: (q: unknown) => Promise<unknown>) => fn({})) };
  const email = {
    send: vi.fn(async (_message: { to: string; subject: string; text: string }) => {}),
  };
  const service = new OtpService(
    db as unknown as DatabaseService,
    otps as unknown as OtpRepository,
    email as unknown as EmailSender,
  );
  return { service, otps, db, email };
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, response: { statusCode: status, code } });
}

describe('OtpService.issue', () => {
  it('persists the code salted+hashed and emails the raw code', async () => {
    const { service, otps, email } = makeService();

    await service.issue('user@example.com');

    expect(otps.consumeAllForEmail).toHaveBeenCalledWith('user@example.com', expect.anything());
    const inserted = otps.insert.mock.calls[0]?.[0] as { codeHash: string; salt: string };
    expect(inserted.salt).toMatch(/^[0-9a-f]{32}$/);
    const mail = email.send.mock.calls[0]?.[0] as { to: string; text: string };
    expect(mail.to).toBe('user@example.com');
    const code = /(\d{6})/.exec(mail.text)?.[0];
    expect(code).toBeDefined();
    // What is stored is sha256(salt:code) — never the raw code.
    expect(inserted.codeHash).toBe(hashOf(inserted.salt, code as string));
    expect(inserted.codeHash).not.toContain(code as string);
  });

  it('rejects with 400 on a malformed email', async () => {
    const { service } = makeService();
    await expectApiError(service.issue('not-an-email'), 400, 'VALIDATION_ERROR');
  });

  it('enforces the 60s resend cooldown', async () => {
    const recent = otpRow({ created_at: new Date(Date.now() - 30_000) });
    const { service, email } = makeService(recent);

    await expectApiError(service.issue('user@example.com'), 429, 'OTP_COOLDOWN');
    await expect(service.issue('user@example.com')).rejects.toMatchObject({
      response: { retryAfterSeconds: expect.any(Number) },
    });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('allows resend once the cooldown has passed', async () => {
    const old = otpRow({
      created_at: new Date(Date.now() - (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000),
    });
    const { service, email } = makeService(old);

    await service.issue('user@example.com');
    expect(email.send).toHaveBeenCalledOnce();
  });

  it('invalidates the stored code and 502s when delivery fails', async () => {
    const { service, otps, email } = makeService();
    email.send.mockRejectedValueOnce(new Error('smtp down'));

    await expectApiError(service.issue('user@example.com'), 502, 'EMAIL_SEND_FAILED');
    expect(otps.markConsumed).toHaveBeenCalledOnce();
  });
});

describe('OtpService.verify', () => {
  it('consumes the code on a correct guess', async () => {
    const { service, otps } = makeService(otpRow());

    await service.verify('user@example.com', '123456');

    expect(otps.markConsumed).toHaveBeenCalledWith('otp-1');
    expect(otps.incrementAttempts).not.toHaveBeenCalled();
  });

  it('rejects malformed codes before hitting the store', async () => {
    const { service, otps } = makeService(otpRow());
    await expectApiError(service.verify('user@example.com', '123'), 400, 'VALIDATION_ERROR');
    expect(otps.findLatest).not.toHaveBeenCalled();
  });

  it('401s when no code was ever issued', async () => {
    const { service } = makeService(null);
    await expectApiError(service.verify('user@example.com', '123456'), 401, 'INVALID_OTP');
  });

  it('rejects replay of an already-consumed code (single-use)', async () => {
    const { service } = makeService(otpRow({ consumed_at: new Date() }));
    await expectApiError(service.verify('user@example.com', '123456'), 401, 'INVALID_OTP');
  });

  it('rejects an expired code', async () => {
    const { service } = makeService(otpRow({ expires_at: new Date(Date.now() - 1000) }));
    await expectApiError(service.verify('user@example.com', '123456'), 401, 'OTP_EXPIRED');
  });

  it('counts a wrong guess as an attempt and 401s', async () => {
    const row = otpRow();
    const { service, otps } = makeService(row);

    await expectApiError(service.verify('user@example.com', '654321'), 401, 'INVALID_OTP');
    expect(otps.incrementAttempts).toHaveBeenCalledWith(row.id);
  });

  it('locks the code after the max attempts, even for the right guess', async () => {
    const { service } = makeService(otpRow({ attempts: OTP_MAX_ATTEMPTS }));
    await expectApiError(
      service.verify('user@example.com', '123456'),
      429,
      'OTP_ATTEMPTS_EXCEEDED',
    );
  });
});
