import { Body, Controller, Get, Patch } from '@nestjs/common';
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
}
