export interface AudioContextHolder {
  current: AudioContext | null;
}

/**
 * Decode and play 24kHz mono PCM16 audio from a base64 payload (orchestrator
 * TTS chunks). Best-effort by design — synthetic audio may fail in mock or
 * headless environments and must never interrupt the interview.
 */
export function playTtsAudio(audioBase64: string, holder?: AudioContextHolder): void {
  try {
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const ctx = holder?.current ?? new AudioContext();
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
    source.start();
  } catch {
    // Synthetic audio playback is best-effort in mock mode.
  }
}
