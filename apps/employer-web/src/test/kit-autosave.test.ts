import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { AUTOSAVE_DELAY_MS, AutosaveController } from '../lib/kit-autosave';

/**
 * Autosave contract tests (FR-E2-1): debounce coalescing, expectedUpdatedAt
 * round-trip, and the 409 STALE_WRITE refetch + rebase recovery.
 */

interface FakeEntity {
  value: string;
  updatedAt: string;
}

interface Harness {
  controller: AutosaveController<{ value?: string }, FakeEntity>;
  sent: Array<{ patch: { value?: string }; expectedUpdatedAt: string }>;
  saved: FakeEntity[];
  conflicts: number;
  errors: string[];
  dirtyLog: boolean[];
  /** Set to make the next send(s) fail with STALE_WRITE. */
  failNextSends: (n: number) => void;
  serverEntity: FakeEntity;
}

function makeHarness(initial: FakeEntity = { value: 'initial', updatedAt: 't0' }): Harness {
  let failuresLeft = 0;
  const sent: Harness['sent'] = [];
  const saved: FakeEntity[] = [];
  const errors: string[] = [];
  const dirtyLog: boolean[] = [];
  let conflicts = 0;
  // The "server" holds its own copy; send fails when the guard token is stale.
  const serverEntity: FakeEntity = { ...initial };

  const controller = new AutosaveController<{ value?: string }, FakeEntity>(initial, {
    send: async (patch, expectedUpdatedAt) => {
      sent.push({ patch, expectedUpdatedAt });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new ApiRequestError(409, 'STALE_WRITE', 'stale write', {
          currentUpdatedAt: serverEntity.updatedAt,
        });
      }
      Object.assign(serverEntity, patch);
      serverEntity.updatedAt = `t${sent.length}`;
      return { ...serverEntity };
    },
    refetch: async () => ({ ...serverEntity }),
    getUpdatedAt: (entity) => entity.updatedAt,
    onSaved: (entity) => saved.push(entity),
    onConflict: () => {
      conflicts += 1;
    },
    onError: (message) => errors.push(message),
    onDirtyChange: (dirty) => dirtyLog.push(dirty),
  });

  return {
    controller,
    sent,
    saved,
    errors,
    dirtyLog,
    get conflicts() {
      return conflicts;
    },
    failNextSends: (n: number) => {
      failuresLeft = n;
    },
    serverEntity,
  };
}

describe('AutosaveController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces rapid edits into a single PATCH with the latest values', async () => {
    const h = makeHarness();
    h.controller.schedule({ value: 'a' });
    h.controller.schedule({ value: 'ab' });
    h.controller.schedule({ value: 'abc' });

    expect(h.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.patch).toEqual({ value: 'abc' });
    expect(h.sent[0]!.expectedUpdatedAt).toBe('t0');
    expect(h.saved.at(-1)?.value).toBe('abc');
  });

  it('sends expectedUpdatedAt and adopts the response token for the next write', async () => {
    const h = makeHarness();
    h.controller.schedule({ value: 'one' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(h.sent[0]!.expectedUpdatedAt).toBe('t0');

    h.controller.schedule({ value: 'two' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    // The server answered the first save with updatedAt t1 — that is the
    // guard token for the second write (optimistic concurrency).
    expect(h.sent[1]!.expectedUpdatedAt).toBe('t1');
    expect(h.saved.at(-1)?.updatedAt).toBe('t2');
  });

  it('is dirty while a patch is pending or in flight, clean after save', async () => {
    const h = makeHarness();
    expect(h.controller.dirty).toBe(false);
    h.controller.schedule({ value: 'x' });
    expect(h.controller.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(h.controller.dirty).toBe(false);
    // schedule(true) → in-flight(still true) → saved(false).
    expect(h.dirtyLog).toEqual([true, true, false]);
  });

  it('recovers from 409 STALE_WRITE: refetch, rebase, resend, conflict notice', async () => {
    const h = makeHarness();
    // Another writer moved the server ahead before our save lands.
    h.serverEntity.value = 'someone else';
    h.serverEntity.updatedAt = 't-other';
    h.failNextSends(1);

    h.controller.schedule({ value: 'mine' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    // Let the conflict refetch + rebase resend settle.
    await vi.runAllTimersAsync();

    expect(h.conflicts).toBe(1);
    // First send 409s, the rebased resend succeeds.
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.expectedUpdatedAt).toBe('t-other');
    // The user's intent won over the refetched state.
    expect(h.serverEntity.value).toBe('mine');
    expect(h.errors).toHaveLength(0);
    expect(h.controller.dirty).toBe(false);
  });

  it('surfaces an error (and keeps edits queued) after repeated conflicts', async () => {
    const h = makeHarness();
    h.failNextSends(10);

    h.controller.schedule({ value: 'mine' });
    await vi.runAllTimersAsync();

    expect(h.errors.length).toBeGreaterThan(0);
    expect(h.errors[0]).toContain('stale');
    // The patch stays queued for a later flush — never silently dropped.
    expect(h.controller.dirty).toBe(true);
  });

  it('flushNow sends immediately without waiting for the debounce window', async () => {
    const h = makeHarness();
    h.controller.schedule({ value: 'urgent' });
    await h.controller.flushNow();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.patch).toEqual({ value: 'urgent' });
  });

  it('merges edits made while a save is in flight into a follow-up PATCH', async () => {
    const h = makeHarness();
    h.controller.schedule({ value: 'first' });
    const flush = h.controller.flushNow();
    h.controller.schedule({ value: 'second' });
    await flush;
    // The in-flight edit chained another flush.
    await vi.runAllTimersAsync();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.patch).toEqual({ value: 'second' });
  });
});
