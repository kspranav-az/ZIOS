import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBadge } from './components/ConnectionBadge';
import { InterviewerBubble } from './components/InterviewerBubble';
import { dispatchTurnEvent, openOrchestratorSocket } from './orchestrator-socket';
import type { TurnEventHandlers } from './orchestrator-socket';
import { floatToPcm16Hex } from './mic-capture';

afterEach(cleanup);

function makeHandlers(overrides: Partial<TurnEventHandlers> = {}) {
  const handlers: TurnEventHandlers = {
    onCaption: vi.fn(),
    onAiText: vi.fn<(text: string | ((prev: string) => string)) => void>(),
    onError: vi.fn(),
    onBargeIn: vi.fn(),
    ...overrides,
  };
  return handlers;
}

describe('dispatchTurnEvent', () => {
  it('routes stt partial/final to onCaption', () => {
    const h = makeHandlers();
    dispatchTurnEvent({ type: 'stt_partial', text: 'hello' }, h);
    dispatchTurnEvent({ type: 'stt_final', text: 'hello world' }, h);
    expect(h.onCaption).toHaveBeenNthCalledWith(1, 'hello');
    expect(h.onCaption).toHaveBeenNthCalledWith(2, 'hello world');
  });

  it('routes ai_text verbatim and swallows backchannels (never voiced by TTS)', () => {
    const onAiText = vi.fn<(text: string | ((prev: string) => string)) => void>();
    const h = makeHandlers({ onAiText });
    dispatchTurnEvent({ type: 'ai_text', text: 'Tell me' }, h);
    dispatchTurnEvent({ type: 'backchannel', text: 'right' }, h);
    expect(onAiText).toHaveBeenCalledTimes(1);
    expect(onAiText).toHaveBeenCalledWith('Tell me');
  });

  it('formats orchestrator errors as "<code>: <message>"', () => {
    const h = makeHandlers();
    dispatchTurnEvent({ type: 'error', code: 'X', message: 'y' }, h);
    expect(h.onError).toHaveBeenCalledWith('X: y');
  });

  it('barge_in clears the interviewer line and telemetry is a no-op', () => {
    const h = makeHandlers();
    dispatchTurnEvent({ type: 'barge_in', turn_index: 2 }, h);
    dispatchTurnEvent({ type: 'telemetry', telemetry: { x: 1 } }, h);
    expect(h.onBargeIn).toHaveBeenCalledOnce();
    expect(h.onAiText).not.toHaveBeenCalled();
  });

  it('tts_audio is best-effort and never throws (no AudioContext in jsdom)', () => {
    const h = makeHandlers();
    expect(() =>
      dispatchTurnEvent({ type: 'tts_audio', audio_base64: 'AAAA', text: 'hi' }, h),
    ).not.toThrow();
  });
});

class MockWebSocket {
  static last: MockWebSocket | null = null;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
  emitOpen() {
    this.onopen?.({} as Event);
  }
  emitClose() {
    this.onclose?.({} as CloseEvent);
  }
}

describe('openOrchestratorSocket', () => {
  it('opens without a bootstrap; the page drives turns via the controller', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const h = makeHandlers({ onOpen: vi.fn() });
    const conn = openOrchestratorSocket('ws://orch/voice/sessions/s1/stream', h);
    const mock = MockWebSocket.last!;
    expect(mock.url).toBe('ws://orch/voice/sessions/s1/stream');
    mock.emitOpen();
    expect(mock.sent).toEqual([]);
    expect(h.onOpen).toHaveBeenCalledOnce();
    // The page elicits the first question and closes candidate turns explicitly.
    conn.sendStartTurn();
    conn.sendEndTurn();
    expect(mock.sent.map((s: string) => JSON.parse(s).type)).toEqual(['start_turn', 'end_turn']);
    vi.unstubAllGlobals();
  });

  it('dispatches parsed frames and forwards close events', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onCaption = vi.fn();
    const onClose = vi.fn();
    openOrchestratorSocket('ws://x', makeHandlers({ onCaption, onClose }));
    const mock = MockWebSocket.last!;
    mock.emitMessage({ type: 'stt_final', text: 'answer' });
    expect(onCaption).toHaveBeenCalledWith('answer');
    mock.emitClose();
    expect(onClose).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('fires onAwaitingAnswer only after queued tts_audio has played out', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onAwaitingAnswer = vi.fn();
    openOrchestratorSocket('ws://x', makeHandlers({ onAwaitingAnswer }));
    const mock = MockWebSocket.last!;
    // jsdom has no AudioContext: playback is best-effort no-op, so the room
    // must still open the mic instead of deadlocking.
    mock.emitMessage({ type: 'tts_audio', audio_base64: 'AAAA', text: 'hi' });
    mock.emitMessage({ type: 'awaiting_answer' });
    expect(onAwaitingAnswer).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('routes interview_complete to its handler', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onInterviewComplete = vi.fn();
    openOrchestratorSocket('ws://x', makeHandlers({ onInterviewComplete }));
    const mock = MockWebSocket.last!;
    mock.emitMessage({ type: 'interview_complete' });
    expect(onInterviewComplete).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('floatToPcm16Hex', () => {
  it('encodes silence as zero bytes', () => {
    expect(floatToPcm16Hex(new Float32Array(4))).toBe('00'.repeat(8));
  });

  it('encodes full-scale samples as int16 LE hex', () => {
    expect(floatToPcm16Hex(new Float32Array([1, -1]))).toBe('ff7f0080');
  });
});

describe('components', () => {
  it('ConnectionBadge reflects quality', () => {
    const { rerender } = render(<ConnectionBadge quality="unknown" />);
    expect(screen.getByText('Connecting…')).toBeDefined();
    rerender(<ConnectionBadge quality="good" />);
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('InterviewerBubble renders nothing without text, interviewer line with text', () => {
    const { container, rerender } = render(<InterviewerBubble text="" />);
    expect(container.firstChild).toBeNull();
    rerender(<InterviewerBubble text="Tell me about yourself" />);
    expect(screen.getByText('Interviewer')).toBeDefined();
    expect(screen.getByText('Tell me about yourself')).toBeDefined();
  });
});
