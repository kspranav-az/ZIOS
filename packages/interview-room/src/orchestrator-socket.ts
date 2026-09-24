import { createMicCapture, type MicCapture } from './mic-capture';
import type { TurnEvent } from './types';
import type { AudioContextHolder } from './tts-audio';
import { playTtsAudio } from './tts-audio';
import { createTtsPlayer } from './tts-player';

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
  /**
   * The AI finished a turn and the room is ready for the candidate's answer.
   * Fires only after all queued TTS audio has actually played out, so opening
   * the mic here never captures the interviewer's own speech.
   */
  onAwaitingAnswer?: () => void;
  /** The conductor completed the interview; the server closes the socket. */
  onInterviewComplete?: () => void;
  /** Socket open (no bootstrap is sent — the page drives the turn flow). */
  onOpen?: () => void;
  /** Socket closed (agent ended or connection dropped). */
  onClose?: () => void;
  /** Socket transport error (before any close event). */
  onTransportError?: () => void;
}

/** Client-to-orchestrator control messages (see orchestrator voice router). */
export type OrchestratorMessage =
  | { type: 'start_turn' }
  | { type: 'audio_chunk'; data: string }
  | { type: 'end_turn' }
  | { type: 'barge_in' };

/** Handle returned by openOrchestratorSocket — the page drives the turns. */
export interface OrchestratorConnection {
  /** Signal the start of a candidate turn; then stream mic chunks and endTurn. */
  sendStartTurn(): void;
  /** One hex PCM16 mono 16kHz mic frame. */
  sendAudioChunk(hexPcm16: string): void;
  /** Candidate finished speaking; the orchestrator transcribes and answers. */
  sendEndTurn(): void;
  /** Interrupt the agent's current speech. */
  sendBargeIn(): void;
  close(): void;
  /** Mic helper bound to this connection's chunk sender. */
  mic: MicCapture;
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
 * Open the orchestrator interview socket for a multi-turn voice room.
 *
 * Protocol: the page calls sendStartTurn when the candidate is ready to speak
 * (on open, to elicit the first question, and on each onAwaitingAnswer), the
 * mic streams hex PCM16 frames, and sendEndTurn closes the candidate turn.
 * tts_audio chunks are queued on a sequential player; onAwaitingAnswer fires
 * only when playback has drained.
 */
export function openOrchestratorSocket(
  wsUrl: string,
  handlers: TurnEventHandlers,
): OrchestratorConnection {
  const ws = new WebSocket(wsUrl);
  const player = createTtsPlayer(handlers.audioContext);
  let closed = false;

  const send = (message: OrchestratorMessage) => {
    if (!closed && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const mic = createMicCapture({
    onChunk: (hex) => send({ type: 'audio_chunk', data: hex }),
    onError: handlers.onError,
  });

  ws.onopen = () => handlers.onOpen?.();
  ws.onmessage = (event: MessageEvent) => {
    let payload: TurnEvent;
    try {
      payload = JSON.parse(event.data as string) as TurnEvent;
    } catch {
      // Ignore malformed frames; the orchestrator contract is versioned.
      return;
    }
    if (payload.type === 'tts_audio') {
      player.enqueue(payload.audio_base64);
      return;
    }
    if (payload.type === 'awaiting_answer') {
      player.whenIdle(() => handlers.onAwaitingAnswer?.());
      return;
    }
    if (payload.type === 'interview_complete') {
      handlers.onInterviewComplete?.();
      return;
    }
    try {
      dispatchTurnEvent(payload, handlers);
    } catch {
      // Dispatch is best-effort; malformed payloads must not kill the room.
    }
  };
  ws.onerror = () => handlers.onTransportError?.();
  ws.onclose = () => {
    closed = true;
    mic.stop();
    player.discard();
    handlers.onClose?.();
  };

  return {
    sendStartTurn: () => send({ type: 'start_turn' }),
    sendAudioChunk: (hexPcm16) => send({ type: 'audio_chunk', data: hexPcm16 }),
    sendEndTurn: () => send({ type: 'end_turn' }),
    sendBargeIn: () => send({ type: 'barge_in' }),
    close: () => ws.close(),
    mic,
  };
}
