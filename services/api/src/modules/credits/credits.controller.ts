import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import type { AppUser } from '@zios/shared-types';
import { BadRequestException } from '@nestjs/common';
import { CurrentUser, Roles } from '@/common/decorators';
import { CreditsService } from './credits.service';
import { CREDIT_PRICING, type PricingKind } from './pricing';
import type { LedgerEntry } from './credits.service';

export interface WalletResponse {
  balance: number;
  lowBalanceThreshold: number;
  pricing: Record<PricingKind, number>;
  ledger: LedgerEntry[];
}

/**
 * Credits wallet (FR-E14): balance, per-mode pricing, append-only ledger,
 * and the low-balance alert threshold. Session-authed like the rest of the
 * employer UI.
 */
@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get('wallet')
  async wallet(@CurrentUser() user: AppUser): Promise<WalletResponse> {
    const accountId = await this.credits.ensureAccount('org', user.orgId);
    const account = await this.credits.getAccount(accountId);
    return {
      balance: account.balance,
      lowBalanceThreshold: account.lowBalanceThreshold,
      pricing: { ...CREDIT_PRICING },
      ledger: await this.credits.listLedger(accountId),
    };
  }

  @Patch('wallet/threshold')
  @Roles('admin')
  async setThreshold(
    @CurrentUser() user: AppUser,
    @Body() body: { threshold?: unknown },
  ): Promise<{ lowBalanceThreshold: number }> {
    const threshold = Number(body?.threshold);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1_000_000) {
      throw new BadRequestException('threshold must be an integer between 0 and 1000000');
    }
    const accountId = await this.credits.ensureAccount('org', user.orgId);
    await this.credits.setLowBalanceThreshold(accountId, threshold);
    return { lowBalanceThreshold: threshold };
  }

  /**
   * Admin top-up (D1/D2): the ONLY manual balance path. Grants credits to
   * the caller's org with an `admin_grant` ledger row recording the granting
   * admin. Top-ups only — no admin debit (product flows are the only debits).
   */
  @Post('admin/topup')
  @Roles('admin')
  async adminTopup(
    @CurrentUser() user: AppUser,
    @Body() body: { amount?: unknown; note?: unknown },
  ): Promise<{ balance: number; ledgerEntryId: string }> {
    const amount = Number(body?.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      throw new BadRequestException('amount must be an integer between 1 and 1000000');
    }
    const note = typeof body?.note === 'string' ? body.note : undefined;
    if (note && note.length > 200) {
      throw new BadRequestException('note must be at most 200 characters');
    }
    return this.credits.adminTopup(user.orgId, amount, user.id, note);
  }
}
