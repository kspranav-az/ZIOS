import { apiFetch } from './api';

export type PricingKind = 'text' | 'voice' | 'video' | 'human' | 'async_video';

export interface LedgerEntryView {
  id: string;
  orgId: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  sessionRef: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WalletView {
  balance: number;
  lowBalanceThreshold: number;
  pricing: Record<PricingKind, number>;
  ledger: LedgerEntryView[];
}

export function fetchWallet(): Promise<WalletView> {
  return apiFetch('/credits/wallet');
}

export function setLowBalanceThreshold(threshold: number): Promise<{ lowBalanceThreshold: number }> {
  return apiFetch('/credits/wallet/threshold', { method: 'PATCH', json: { threshold } });
}
