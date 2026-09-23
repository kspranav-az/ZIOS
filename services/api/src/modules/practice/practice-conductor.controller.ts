import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Public } from '@/common/decorators';
import { PracticeService } from './practice.service';

/**
 * Orchestrator-facing practice routes (Phase 12e, live mode). Deliberately
 * separate from PracticeController: NO CandidateAuthGuard here — the
 * recovery token is the only credential, exactly the trust posture of the
 * company-interview conductor endpoint (/sessions/:id/turn). These routes
 * accept recovery tokens, never candidate JWTs, so they cannot double as
 * account-authenticated paths.
 */
@Public()
@Controller('cand/practice/conductor')
export class PracticeConductorController {
  constructor(private readonly practice: PracticeService) {}

  /** Next turn / answer submission for a live practice room. */
  @Post(':id/turn')
  @HttpCode(200)
  async turn(
    @Param('id') id: string,
    @Headers('x-recovery-token') recoveryToken: string,
    @Body() body: { answer?: string; recordingRef?: string },
  ) {
    return this.practice.turnByRecoveryToken(id, recoveryToken ?? '', body ?? {});
  }

  /**
   * Per-turn telemetry sink. The practice engine does not consume voice
   * telemetry today; accepted so the orchestrator's telemetry reporting has
   * a stable target (no-op, never fails the interview).
   */
  @Post(':id/telemetry')
  @HttpCode(200)
  async telemetry() {
    return { ok: true };
  }
}
