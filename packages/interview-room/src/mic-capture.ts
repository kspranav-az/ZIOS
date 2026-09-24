/**
 * Browser microphone capture for the orchestrator voice room.
 *
 * The orchestrator STT port contract is raw PCM16 mono **16 kHz**, sent as
 * hex `audio_chunk` frames over the control WebSocket. Browsers capture at
 * the device rate (typically 44.1/48 kHz), so we run a dedicated
 * AudioContext at 16 kHz — connecting a MediaStreamSource to it makes the
 * browser resample for us — and pull Float32 frames via a ScriptProcessor
 * node, converting to PCM16 inline.
 *
 * Push-to-talk by design: the room page starts capture when the
 * orchestrator signals `awaiting_answer` and stops it when the candidate
 * sends the turn. No VAD — the candidate controls when the answer is final.
 */

/** Wire sample rate the orchestrator STT adapters expect (see GCP adapter). */
export const MIC_SAMPLE_RATE = 16000;

/**
 * Convert a Float32 audio frame to little-endian PCM16 hex, the exact shape
 * the WS `audio_chunk` message carries. Exported pure for unit tests.
 */
export function floatToPcm16Hex(samples: Float32Array): string {
  const view = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(view.buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export interface MicCapture {
  /** Begin streaming mic frames; resolves true once capture is live. */
  start(): Promise<boolean>;
  /** Stop capture and release the mic. Safe to call when not active. */
  stop(): void;
  readonly active: boolean;
}

export interface MicCaptureOptions {
  /** Called on every captured frame with hex PCM16 payload. */
  onChunk: (hex: string) => void;
  /** Mic permission or capture failure — surfaced as a room error. */
  onError?: (message: string) => void;
}

export function createMicCapture(options: MicCaptureOptions): MicCapture {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let sink: GainNode | null = null;
  let state: 'idle' | 'starting' | 'active' = 'idle';

  const teardown = () => {
    processor?.disconnect();
    source?.disconnect();
    sink?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    void ctx?.close().catch(() => undefined);
    stream = null;
    ctx = null;
    processor = null;
    source = null;
    sink = null;
    state = 'idle';
  };

  return {
    get active() {
      return state === 'active';
    },

    async start() {
      if (state !== 'idle') return state === 'active';
      state = 'starting';
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        // 16 kHz context: the browser resamples the device stream for us.
        ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          const frame = event.inputBuffer.getChannelData(0);
          if (frame.length > 0) options.onChunk(floatToPcm16Hex(frame));
        };
        // ScriptProcessor only runs while connected to the destination;
        // a zero-gain sink keeps it processing without audible feedback.
        sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(processor);
        processor.connect(sink);
        sink.connect(ctx.destination);
        state = 'active';
        return true;
      } catch {
        teardown();
        options.onError?.('Microphone access was denied. Allow the mic and try again.');
        return false;
      }
    },

    stop() {
      if (state === 'idle') return;
      teardown();
    },
  };
}
