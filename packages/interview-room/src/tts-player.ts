import type { AudioContextHolder } from './tts-audio';

/**
 * Sequential TTS player for the orchestrator voice room.
 *
 * The orchestrator streams `tts_audio` chunks faster than realtime; the room
 * must not open the microphone until the interviewer has actually finished
 * speaking. This player chains AudioBufferSources on one AudioContext so
 * chunks play back-to-back, and exposes `whenIdle` — the signal the room
 * uses to start listening.
 *
 * Best-effort by design, mirroring playTtsAudio: synthetic audio may fail in
 * mock or headless environments and must never interrupt the interview.
 * When no AudioContext is available (jsdom), whenIdle fires immediately so
 * the room flow never deadlocks.
 */

export interface TtsPlayer {
  /** Queue one base64 PCM16 24kHz mono chunk for playback. */
  enqueue(audioBase64: string): void;
  /**
   * Invoke the callback once everything queued so far has finished playing.
   * Fires immediately when nothing is playing or playback is unavailable.
   */
  whenIdle(callback: () => void): void;
  /** Drop queued audio and stop playback (leave / teardown). */
  discard(): void;
}

export function createTtsPlayer(holder?: AudioContextHolder): TtsPlayer {
  let ctx: AudioContext | null = null;
  let pendingEnds = 0;
  let lastEndAt = 0;
  const idleWaiters: Array<() => void> = [];

  const flushWaiters = () => {
    if (pendingEnds === 0) {
      while (idleWaiters.length > 0) idleWaiters.shift()?.();
    }
  };

  return {
    enqueue(audioBase64: string) {
      try {
        const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
        ctx = holder?.current ?? ctx ?? new AudioContext();
        if (holder) holder.current = ctx;
        const buffer = ctx.createBuffer(1, bytes.length / 2, 24000);
        const channel = buffer.getChannelData(0);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < channel.length; i += 1) {
          channel[i] = view.getInt16(i * 2, true) / 32768;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        const startAt = Math.max(ctx.currentTime, lastEndAt);
        lastEndAt = startAt + buffer.duration;
        pendingEnds += 1;
        source.onended = () => {
          pendingEnds -= 1;
          flushWaiters();
        };
        source.start(startAt);
      } catch {
        // Synthetic audio playback is best-effort in mock mode.
      }
    },

    whenIdle(callback: () => void) {
      if (pendingEnds === 0) {
        callback();
        return;
      }
      idleWaiters.push(callback);
    },

    discard() {
      idleWaiters.length = 0;
      pendingEnds = 0;
      lastEndAt = 0;
      // Sources already scheduled keep playing out their short buffers;
      // resetting the counters is enough for room-teardown purposes.
    },
  };
}
