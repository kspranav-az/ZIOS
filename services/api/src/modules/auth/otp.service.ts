import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiException, assertValidEmail } from '@/common/errors';
import { DatabaseService } from '@/modules/database';
import { EMAIL_SENDER, type EmailSender } from '@/modules/notifications';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS } from './auth.constants';
import { OtpRepository } from './otp.repository';

function hashCode(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Email+OTP lifecycle (FR-E1-1): 6-digit codes, salted-sha256 at rest,
 * 10-minute expiry, single-use, max 5 verify attempts, 60s resend cooldown.
 * Codes are pre-tenant (keyed by email) — no org exists before first login.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly db: DatabaseService,
    private readonly otps: OtpRepository,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  /** Issues and emails a new code; superseding any active one. */
  async issue(rawEmail: unknown): Promise<void> {
    assertValidEmail(rawEmail);
    const email = rawEmail.trim();

    const latest = await this.otps.findLatest(email);
    if (latest) {
      const elapsedSeconds = (Date.now() - latest.created_at.getTime()) / 1000;
      if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
        throw new ApiException(
          429,
          'OTP_COOLDOWN',
          'a code was sent recently — please wait before requesting another',
          { retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds) },
        );
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const row = await this.db.transaction(async (client) => {
      await this.otps.consumeAllForEmail(email, client);
      return this.otps.insert(
        {
          email,
          codeHash: hashCode(salt, code),
          salt,
          expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
        },
        client,
      );
    });

    try {
      await this.email.send({
        to: email,
        subject: 'Your InterviewOS sign-in code',
        text: [
          `Your InterviewOS sign-in code is ${code}.`,
          '',
          `It expires in ${OTP_TTL_SECONDS / 60} minutes and can be used once.`,
          'If you did not request it, you can ignore this email.',
        ].join('\n'),
      });
    } catch {
      // Delivery failed — invalidate the row so an immediate retry is possible.
      await this.otps.markConsumed(row.id);
      throw new ApiException(
        502,
        'EMAIL_SEND_FAILED',
        'could not deliver the sign-in code — please try again',
      );
    }
  }

  /** Verifies a code; throws ApiException on every failure path. */
  async verify(rawEmail: unknown, rawCode: unknown): Promise<void> {
    assertValidEmail(rawEmail);
    if (typeof rawCode !== 'string' || !/^\d{6}$/.test(rawCode)) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'a 6-digit code is required');
    }
    const email = rawEmail.trim();

    const latest = await this.otps.findLatest(email);
    if (!latest || latest.consumed_at !== null) {
      throw new ApiException(401, 'INVALID_OTP', 'invalid or expired sign-in code');
    }
    if (latest.attempts >= OTP_MAX_ATTEMPTS) {
      throw new ApiException(
        429,
        'OTP_ATTEMPTS_EXCEEDED',
        'too many wrong attempts — request a new code',
      );
    }
    if (latest.expires_at.getTime() <= Date.now()) {
      throw new ApiException(401, 'OTP_EXPIRED', 'the code has expired — request a new one');
    }
    if (!hashesEqual(hashCode(latest.salt, rawCode), latest.code_hash)) {
      await this.otps.incrementAttempts(latest.id);
      throw new ApiException(401, 'INVALID_OTP', 'invalid or expired sign-in code');
    }
    await this.otps.markConsumed(latest.id);
  }
}
