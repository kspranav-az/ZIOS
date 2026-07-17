import { ApiRequestError } from './api';

/**
 * Debounced autosave with the api's optimistic-concurrency contract
 * (FR-E2-1, kits module README):
 *
 * - edits merge into a pending patch and flush ~800ms after the last edit;
 * - every PATCH sends the last known `updatedAt` as `expectedUpdatedAt`;
 * - on success the server's fresh entity replaces local state (its
 *   `updatedAt` becomes the next guard token);
 * - on 409 STALE_WRITE the entity is refetched, the user's pending patch is
 *   re-based on top (their intent wins) and resent — surfaced as a
 *   non-blocking notice, never a modal;
 * - `dirty` (pending patch or in-flight PATCH) drives the route-leave guard.
 *
 * Framework-free: the page injects `send`/`refetch` and subscribes to
 * callbacks; unit tests drive it with fake timers and stub transports.
 */

export const AUTOSAVE_DELAY_MS = 800;
/** Consecutive STALE_WRITEs before giving up (protects against retry loops). */
const MAX_CONFLICT_RETRIES = 3;

export function isStaleWrite(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'STALE_WRITE';
}

export interface AutosaveControllerOptions<TPatch extends object, TOwner> {
  /** Debounce window; defaults to AUTOSAVE_DELAY_MS. */
  delayMs?: number;
  /** PATCH transport: merged patch + the guard token. Resolves to the fresh entity. */
  send: (patch: TPatch, expectedUpdatedAt: string) => Promise<TOwner>;
  /** GET transport used for the 409 rebase. Resolves to the fresh entity. */
  refetch: () => Promise<TOwner>;
  /** Reads the optimistic-concurrency token off an entity. */
  getUpdatedAt: (owner: TOwner) => string;
  /** Server truth landed (save or rebase refetch) — replace local state. */
  onSaved: (owner: TOwner) => void;
  /** A 409 was recovered by refetch + rebase (non-blocking toast hook). */
  onConflict?: () => void;
  /** Unrecoverable failure (network, validation, repeated 409) — toast hook. */
  onError?: (message: string) => void;
  /** dirty flag changed (drives the unsaved-changes route guard). */
  onDirtyChange?: (dirty: boolean) => void;
}

export class AutosaveController<TPatch extends object, TOwner> {
  private pending: TPatch | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private conflictRetries = 0;
  private updatedAt: string;
  private destroyed = false;
  private flushPromise: Promise<void> | null = null;

  constructor(
    initialOwner: TOwner,
    private readonly options: AutosaveControllerOptions<TPatch, TOwner>,
  ) {
    this.updatedAt = options.getUpdatedAt(initialOwner);
  }

  /** External state change (e.g. a structural op bumped the kit's updatedAt). */
  setOwner(owner: TOwner): void {
    this.updatedAt = this.options.getUpdatedAt(owner);
  }

  get dirty(): boolean {
    return this.pending !== null || this.inFlight;
  }

  /** Field names with unsent (or being-retried) edits — used to shield
   *  optimistic local values from being clobbered by server echoes. */
  get pendingKeys(): string[] {
    return this.pending === null ? [] : Object.keys(this.pending);
  }

  /** Merge an edit and (re)start the debounce window. */
  schedule(patch: TPatch): void {
    if (this.destroyed) return;
    this.pending = { ...(this.pending ?? {}), ...patch } as TPatch;
    this.notifyDirty();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  /** Send any pending patch immediately; resolves when the save settles. */
  flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.flush();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private notifyDirty(): void {
    this.options.onDirtyChange?.(this.dirty);
  }

  private flush(): Promise<void> {
    // Serialize flushes: a save triggered while one is in flight chains on.
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.doFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async doFlush(): Promise<void> {
    if (this.destroyed || this.pending === null || this.inFlight) return;

    const patch = this.pending;
    this.pending = null;
    this.inFlight = true;
    this.notifyDirty();
    let chainNext = false;

    try {
      const fresh = await this.options.send(patch, this.updatedAt);
      this.updatedAt = this.options.getUpdatedAt(fresh);
      this.conflictRetries = 0;
      this.options.onSaved(fresh);
      chainNext = true;
    } catch (error) {
      let recovered = false;
      if (isStaleWrite(error) && this.conflictRetries < MAX_CONFLICT_RETRIES) {
        this.conflictRetries += 1;
        // Re-queue the user's patch (plus anything typed during the flight)
        // BEFORE the refetch hands fresh state down, so pendingKeys shields
        // the user's optimistic values from being overwritten on screen.
        this.pending = { ...patch, ...(this.pending ?? {}) } as TPatch;
        try {
          // Rebase: refetch server truth, hand it down, then re-apply the
          // user's patch on top — their intent is never silently dropped.
          const fresh = await this.options.refetch();
          this.updatedAt = this.options.getUpdatedAt(fresh);
          this.options.onSaved(fresh);
          this.options.onConflict?.();
          recovered = true;
        } catch {
          recovered = false; // refetch failed — fall through to error handling
        }
        chainNext = recovered;
      }
      if (!recovered && !(isStaleWrite(error) && this.conflictRetries < MAX_CONFLICT_RETRIES)) {
        // Unrecoverable (or out of conflict retries): keep the edits queued
        // so a later flush can retry, and surface a non-blocking error.
        this.pending = { ...patch, ...(this.pending ?? {}) } as TPatch;
        const message =
          error instanceof ApiRequestError
            ? error.message
            : 'Could not save your changes. They will be retried.';
        this.options.onError?.(message);
      }
    } finally {
      this.inFlight = false;
      this.notifyDirty();
    }

    // Edits accumulated during a successful flight (or a recovered rebase)
    // flush next — call doFlush directly: flush() would return the promise
    // we are currently settling and self-await. After an unrecoverable
    // failure the queued patch waits for the next schedule()/flushNow()
    // instead of hot-looping.
    if (chainNext && this.pending !== null) await this.doFlush();
  }
}
