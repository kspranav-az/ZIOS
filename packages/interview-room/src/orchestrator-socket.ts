import type { AudioContextHolder } from './tts-audio';
import { playTtsAudio } from './tts-audio';
import type { TurnEvent } from './types';

export interface TurnEventHandlers {
  /** STT partial/final transcripts (live captions). */
  onCaption: (text: string) => void;
  /** Interviewer text; may be a functional update (backchannels append). */
  onAiText: (text: string | ((prev: string) => string)) => void;
  /** Orchestrator-reported error, preformatted as "<code>: <message>". */
  onError: (message: string) => void;
  /** Candidate interrupted the agent — clear the interviewer line. */
  onBargeIn: () => void;
  /** Page-owned AudioContext holder for TTS playback (created lazily). */
  audioContext?: AudioContextHolder;
  /** Socket open + interview bootstrap sequence sent. */
  onOpen?: () => void;
  /** Socket closed (agent ended or connection dropped). */
  onClose?: () => void;
  /** Socket transport error (before any close event). */
  onTransportError?: () => void;
}

/**
 * Route one orchestrator turn event to UI state. TTS playback, backchannel
 * merging, and telemetry are handled here so every room stays behavior-identical.
 */
export function dispatchTurnEvent(payload: TurnEvent, handlers: TurnEventHandlers): void {
  switch (payload.type) {
    case 'stt_partial':
    case 'stt_final':
      handlers.onCaption(payload.text);
      break;
    case 'ai_text':
      handlers.onAiText(payload.text);
      break;
    case 'tts_audio':
      playTtsAudio(payload.audio_base64, handlers.audioContext);
      break;
    case 'backchannel':
      handlers.onAiText((prev) => (prev ? `${prev} (${payload.text})` : payload.text));
      break;
    case 'telemetry':
      // Telemetry is reported by the orchestrator; UI can surface a debug summary later.
      break;
    case 'barge_in':
      handlers.onBargeIn();
      break;
    case 'error':
      handlers.onError(`${payload.code}: ${payload.message}`);
      break;
    default:
      break;
  }
}

/**
 * Open the orchestrator interview socket and send the bootstrap sequence that
 * triggers the first AI question (start_turn + one dummy audio chunk to wake
 * the mock STT pipeline + end_turn). Behavior mirrored from the original
 * candidate-web voice/video pages — do not change without updating both.
 */
export function openOrchestratorSocket(wsUrl: string, handlers: TurnEventHandlers): WebSocket {
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'start_turn' }));
    ws.send(JSON.stringify({ type: 'audio_chunk', data: '00'.repeat(320) }));
    ws.send(JSON.stringify({ type: 'end_turn' }));
    handlers.onOpen?.();
  };
  ws.onmessage = (event: MessageEvent) => {
    try {
      dispatchTurnEvent(JSON.parse(event.data as string) as TurnEvent, handlers);
    } catch {
      // Ignore malformed frames; the orchestrator contract is versioned.
    }
  };
  ws.onerror = () => handlers.onTransportError?.();
  ws.onclose = () => handlers.onClose?.();
  return ws;
}
