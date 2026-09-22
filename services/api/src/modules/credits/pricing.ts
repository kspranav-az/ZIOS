import type { InterviewMode, SessionConductor } from '@zios/shared-types';
import { ApiException } from '@/common/errors';

/**
 * Credit pricing — single source of truth for what an interview costs
 * (FR-E14-1).
 *
 * Keys are pricing *kinds*, not raw session modes: human-conductor sessions
 * are priced independently of the media mode (no AI judge runs), and async
 * video is its own product even though its session row uses mode 'video'.
 */
export type PricingKind = 'text' | 'voice' | 'video' | 'human' | 'async_video';

export const CREDIT_PRICING: Record<PricingKind, number> = {
  text: 1,
  voice: 2,
  video: 3,
  human: 1,
  async_video: 3,
};

export function priceForKind(kind: PricingKind): number {
  const price = CREDIT_PRICING[kind];
  if (price === undefined) {
    throw new ApiException(400, 'MODE_NOT_SUPPORTED', `no pricing for kind ${kind}`);
  }
  return price;
}

/** Price for a live session start, given its media mode and conductor. */
export function priceForSession(mode: InterviewMode, conductor: SessionConductor): number {
  return conductor === 'human' ? priceForKind('human') : priceForKind(mode as PricingKind);
}

/**
 * Pre-check that an org can afford to START a session. The real guard is the
 * atomic debit (adjustCredits fails closed), so a racing second start still
 * gets 402 — this exists to fail fast with a clear error before any work is
 * done. In-flight sessions are unaffected by design: the check only runs at
 * start transitions.
 */
export async function assertCanStart(
  getBalance: (orgId: string) => Promise<number>,
  orgId: string,
  amount: number,
): Promise<void> {
  const balance = await getBalance(orgId);
  if (balance < amount) {
    throw new ApiException(
      402,
      'INSUFFICIENT_CREDITS',
      `starting this interview costs ${amount} credits; balance is ${balance}`,
    );
  }
}
