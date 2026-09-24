import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '@zios/ui';
import {
  ConnectionBadge,
  InterviewerBubble,
  connectRoomSession,
  openOrchestratorSocket,
  type ConnectionQuality,
  type OrchestratorConnection,
  type RoomSession,
} from '@zios/interview-room';
import type { IntegrityEventBody } from '@zios/shared-types';
import { ApiErrorResponse, fallbackToText, getVoiceToken, recordIntegrityEvents } from '../api';
import { loadRecovery, loadStoredSessionId, useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageShell } from '../components/PageShell';

const ORCHESTRATOR_BASE =
  (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'ws://localhost:8000';

const SNAPSHOT_INTERVAL_MS = 15_000;

function nowIso(): string {
  return new Date().toISOString();
}

function captureSnapshot(video: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

export function VideoInterviewPage() {
  const navigate = useNavigate();
  const { session: contextSession, recoveryToken: contextRecoveryToken } = useInterview();
  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);
  const [recoveredRecoveryToken, setRecoveredRecoveryToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [aiText, setAiText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  /** Socket liveness — drives the reconnect overlay (not the mic state). */
  const [roomActive, setRoomActive] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>('unknown');
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [flagCount, setFlagCount] = useState(0);

  const sessionRef = useRef<RoomSession | null>(null);
  const connRef = useRef<OrchestratorConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);

  const session = contextSession;
  const recoveryToken = contextRecoveryToken ?? recoveredRecoveryToken;
  const sessionId = session?.id ?? recoveredSessionId;

  useEffect(() => {
    if (contextSession && contextRecoveryToken) return;
    const storedSessionId = loadStoredSessionId();
    const storedRecoveryToken = storedSessionId ? loadRecovery(storedSessionId) : null;
    if (storedSessionId && storedRecoveryToken) {
      setRecoveredSessionId(storedSessionId);
      setRecoveredRecoveryToken(storedRecoveryToken);
    }
  }, [contextSession, contextRecoveryToken]);

  const sendIntegrityEvents = useCallback(
    async (events: IntegrityEventBody['events']) => {
      if (!sessionId) return;
      try {
        const response = await recordIntegrityEvents(sessionId, { events });
        setFlagCount((prev) => prev + response.flags.length);
      } catch {
        // Integrity telemetry is best-effort; do not interrupt the interview.
      }
    },
    [sessionId],
  );

  const captureAndSendSnapshot = useCallback(() => {
    const video = videoElementRef.current;
    if (!video || video.readyState < 2) return;
    const dataUrl = captureSnapshot(video);
    if (!dataUrl) return;
    void sendIntegrityEvents([
      {
        signal: 'webcam_snapshot',
        occurredAt: nowIso(),
        evidence: { dataUrlLength: dataUrl.length, dataUrlPrefix: dataUrl.slice(0, 60) },
      },
    ]);
  }, [sendIntegrityEvents]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        void sendIntegrityEvents([
          { signal: 'tab_switch', occurredAt: nowIso(), evidence: { hidden: true } },
        ]);
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        void sendIntegrityEvents([
          { signal: 'fullscreen_exit', occurredAt: nowIso(), evidence: { fullscreen: false } },
        ]);
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      void sendIntegrityEvents([
        {
          signal: 'paste_attempt',
          occurredAt: nowIso(),
          evidence: { tagName: target?.tagName, id: target?.id },
        },
      ]);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('paste', onPaste);
    };
  }, [sendIntegrityEvents]);

  useEffect(() => {
    if (!sessionId || !recoveryToken) return;

    const token = recoveryToken as string;
    const sid = sessionId as string;
    let cancelled = false;

    async function startVideo() {
      try {
        const tokenResponse = await getVoiceToken(sid, token);
        if (cancelled) return;

        const { livekit, orchestrator } = tokenResponse;
        const roomSession = await connectRoomSession({
          url: livekit.url,
          token: livekit.token,
          videoElement: videoElementRef.current,
          onConnectionQuality: (quality) => setConnectionQuality(quality),
        });
        if (cancelled) {
          void roomSession.disconnect();
          return;
        }
        sessionRef.current = roomSession;

        snapshotTimerRef.current = window.setInterval(
          captureAndSendSnapshot,
          SNAPSHOT_INTERVAL_MS,
        );

        const wsUrl = `${ORCHESTRATOR_BASE.replace(/^http/, 'ws')}${orchestrator.wsUrl}`;
        const conn = openOrchestratorSocket(wsUrl, {
          audioContext: audioContextRef,
          onCaption: setCaption,
          onAiText: setAiText,
          onError: setError,
          onBargeIn: () => setAiText(''),
          onOpen: () => {
            setConnecting(false);
            setRoomActive(true);
            // Elicit the first question: an empty bootstrap turn makes the
            // conductor re-present the current question with TTS.
            conn.sendStartTurn();
            conn.sendEndTurn();
          },
          onAwaitingAnswer: () => {
            // Open the next turn, then the mic — the AI finished speaking.
            conn.sendStartTurn();
            void conn.mic.start().then((live) => {
              if (live) setIsListening(true);
            });
          },
          onInterviewComplete: () => {
            setIsListening(false);
            navigate('/complete', { replace: true });
          },
          onClose: () => {
            setIsListening(false);
            setRoomActive(false);
          },
          onTransportError: () => setError('Video connection error. Please try again.'),
        });
        connRef.current = conn;
      } catch (err) {
        setConnecting(false);
        setError(
          err instanceof ApiErrorResponse
            ? err.message
            : 'Could not start video interview. Please try again.',
        );
      }
    }

    void startVideo();

    return () => {
      cancelled = true;
      if (snapshotTimerRef.current) window.clearInterval(snapshotTimerRef.current);
      connRef.current?.mic.stop();
      connRef.current?.close();
      void sessionRef.current?.disconnect();
      void audioContextRef.current?.close();
    };
  }, [sessionId, recoveryToken, captureAndSendSnapshot]);

  const handleToggleMute = () => {
    const audioTrack = sessionRef.current?.localAudioTrack;
    if (!audioTrack) return;
    if (audioTrack.isMuted) {
      void audioTrack.unmute();
      setIsMuted(false);
      if (isListening) void connRef.current?.mic.start();
    } else {
      void audioTrack.mute();
      setIsMuted(true);
      connRef.current?.mic.stop();
    }
  };

  const handleSendAnswer = () => {
    const conn = connRef.current;
    if (!conn) return;
    conn.mic.stop();
    setIsListening(false);
    conn.sendEndTurn();
  };

  const handleToggleCamera = () => {
    const videoTrack = sessionRef.current?.localVideoTrack;
    if (!videoTrack) return;
    if (videoTrack.isMuted) {
      void videoTrack.unmute();
    } else {
      void videoTrack.mute();
    }
  };

  const handleFallback = async () => {
    if (!sessionId || !recoveryToken) return;
    setFallbackLoading(true);
    try {
      await fallbackToText(sessionId, recoveryToken, { reason: 'candidate-request' });
      navigate('/interview', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not switch to text mode. Please try again.',
      );
    } finally {
      setFallbackLoading(false);
    }
  };

  if (!sessionId || !recoveryToken) {
    return (
      <ErrorState
        title="Session not found"
        message="We could not find your interview session. Please open the invite link again."
      />
    );
  }

  if (connecting) return <LoadingState message="Starting your video interview…" />;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-headline-sm text-on-surface">Video interview</h1>
          <div className="flex items-center gap-3">
            {flagCount > 0 && (
              <span className="rounded-full bg-warning/10 px-2 py-1 text-label-bold text-warning">
                {flagCount} integrity flag{flagCount === 1 ? '' : 's'}
              </span>
            )}
            <ConnectionBadge quality={connectionQuality} />
          </div>
        </div>

        <Card padding="lg" radius="2xl">
          <InterviewerBubble text={aiText} />

          <div className="relative overflow-hidden rounded-xl bg-surface-container-low">
            <video
              ref={videoElementRef}
              autoPlay
              playsInline
              muted
              className="aspect-video w-full object-cover"
            />
            {!roomActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <p className="text-body-md text-white">Reconnecting…</p>
              </div>
            )}
          </div>

          {caption && (
            <p className="mt-4 rounded-lg bg-surface-container p-3 text-body-md text-on-surface">
              “{caption}”
            </p>
          )}

          {error && (
            <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleToggleMute}
                icon={isMuted ? 'mic_off' : 'mic'}
              >
                {isMuted ? 'Unmute' : 'Mute'}
              </Button>
              <Button variant="outline" onClick={handleToggleCamera} icon="videocam">
                Camera
              </Button>
              {isListening && (
                <Button variant="primary" onClick={handleSendAnswer} icon="send">
                  Send answer
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              onClick={handleFallback}
              loading={fallbackLoading}
              icon="chat"
            >
              Switch to text
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
