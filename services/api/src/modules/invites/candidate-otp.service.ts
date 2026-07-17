import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OTP_SENDER, type OtpSender } from '@/modules/notifications';
import type { CandidateOtpRow } from './candidate-otp.repository';
import { CandidateOtpRepository } from './candidate-otp.repository';
import type { Queryable } from '@/modules/database';

const OTP_TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

@Injectable()
export class CandidateOtpService {
  constructor(
    private readonly repository: CandidateOtpRepository,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  static hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private generateCode(): string {
    // 6-digit code, leading zeros possible but randomInt(0, 999999) covers them.
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  async requestOtp(
    inviteId: string,
    email: string,
    q: Queryable,
  ): Promise<{ expiresInSeconds: number }> {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
    await this.repository.revokeActiveForInvite(inviteId, q);
    await this.repository.insert(
      { inviteId, codeHash: CandidateOtpService.hashCode(code), expiresAt },
      q,
    );
    await this.sender.send(email, code);
    return { expiresInSeconds: OTP_TTL_SECONDS };
  }

  async verifyOtp(inviteId: string, code: string, q: Queryable): Promise<boolean> {
    const row = await this.repository.findLatestByInviteId(inviteId, q);
    if (!row) {
      return false;
    }
    if (row.consumed_at) {
      return false;
    }
    if (new Date() > row.expires_at) {
      return false;
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await this.repository.consume(row.id, q);
      return false;
    }
    await this.repository.incrementAttempts(row.id, q);
    const ok = CandidateOtpService.hashCode(code) === row.code_hash;
    if (!ok) {
      return false;
    }
    await this.repository.consume(row.id, q);
    return true;
  }

  /** Exposed for tests that need to mint a known code hash. */
  mintRow(
    input: { inviteId: string; codeHash: string; expiresAt: Date },
    q: Queryable,
  ): Promise<CandidateOtpRow> {
    return this.repository.insert(input, q);
  }
}
