import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '@/common/errors';
import {
  CREDIT_PRICING,
  assertCanStart,
  priceForKind,
  priceForSession,
} from './pricing';

describe('credit pricing (FR-E14-1)', () => {
  it('prices every pricing kind', () => {
    expect(CREDIT_PRICING).toEqual({
      text: 1,
      voice: 2,
      video: 3,
      human: 1,
      async_video: 3,
    });
  });

  it('priceForKind returns the mapped price', () => {
    expect(priceForKind('text')).toBe(1);
    expect(priceForKind('async_video')).toBe(3);
  });

  it('priceForKind rejects unknown kinds', () => {
    expect(() => priceForKind('nope' as never)).toThrow(ApiException);
    try {
      priceForKind('nope' as never);
      expect.unreachable('priceForKind should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      const body = (error as ApiException).getResponse() as { statusCode: number; code: string };
      expect(body.statusCode).toBe(400);
      expect(body.code).toBe('MODE_NOT_SUPPORTED');
    }
  });

  it('prices live sessions by media mode for AI conductors', () => {
    expect(priceForSession('text', 'ai')).toBe(1);
    expect(priceForSession('voice', 'ai')).toBe(2);
    expect(priceForSession('video', 'ai')).toBe(3);
  });

  it('prices human-conductor sessions by the human kind regardless of mode', () => {
    // Human panels run no AI judge stack, so the price is flat per session.
    expect(priceForSession('video', 'human')).toBe(1);
    expect(priceForSession('voice', 'human')).toBe(1);
    expect(priceForSession('text', 'human')).toBe(1);
  });

  it('assertCanStart passes when the balance covers the price', async () => {
    const getBalance = vi.fn().mockResolvedValue(3);
    await expect(assertCanStart(getBalance, 'org-1', 3)).resolves.toBeUndefined();
    expect(getBalance).toHaveBeenCalledWith('org-1');
  });

  it('assertCanStart throws 402 when the balance is short', async () => {
    const getBalance = vi.fn().mockResolvedValue(1);
    const failure = assertCanStart(getBalance, 'org-1', 2);
    await expect(failure).rejects.toThrow(ApiException);
    await failure.catch((error: ApiException) => {
      const body = error.getResponse() as { statusCode: number; code: string };
      expect(body.statusCode).toBe(402);
      expect(body.code).toBe('INSUFFICIENT_CREDITS');
    });
  });
});
