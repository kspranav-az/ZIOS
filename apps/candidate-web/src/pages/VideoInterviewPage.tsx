import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import {
  Room,
  RoomEvent,
  Track,
  type LocalVideoTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
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

type TurnEvent =
  | { type: 'stt_partial'; text: string }
  | { type: 'stt_final'; text: string }
  | { type: 'ai_text'; text: string }
  | { type: 'tts_audio'; audio_base64: string; text: string }
  | { type: 'backchannel'; text: string }
  | { type: 'telemetry'; telemetry: Record<string, unknown> }
  | { type: 'barge_in'; turn_index: number }
  | { type: 'error'; code: string; message: string };

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
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'poor' | 'unknown'>(
    'unknown',
  );
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [flagCount, setFlagCount] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localVideoRef = useRef<LocalVideoTrack | null>(null);
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

  const playAudio = useCallback((audioBase64: string) => {
    try {
      const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const ctx = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = ctx;
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
  }, []);

  const handleOrchestratorMessage = useCallback(
    (event: MessageEvent) => {
      const payload = JSON.parse(event.data as string) as TurnEvent;
      switch (payload.type) {
        case 'stt_partial':
          setCaption(payload.text);
          break;
        case 'stt_final':
          setCaption(payload.text);
          break;
        case 'ai_text':
          setAiText(payload.text);
          break;
        case 'tts_audio':
          playAudio(payload.audio_base64);
          break;
        case 'backchannel':
          setAiText((prev) => (prev ? `${prev} (${payload.text})` : payload.text));
          break;
        case 'telemetry':
          break;
        case 'barge_in':
          setAiText('');
          break;
        case 'error':
          setError(`${payload.code}: ${payload.message}`);
          break;
        default:
          break;
      }
    },
    [playAudio],
  );

  useEffect(() => {
    if (!sessionId || !recoveryToken) return;

    const token = recoveryToken as string;
    const sid = sessionId as string;
    let cancelled = false;

    async function startVideo() {
      if (!token) return;
      try {
        const tokenResponse = await getVoiceToken(sid, token);
        if (cancelled) return;

        const { livekit, orchestrator } = tokenResponse;
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: { simulcast: false },
        });
        roomRef.current = room;

        room.on(
          RoomEvent.TrackSubscribed,
          (_track: RemoteTrack, publication: RemoteTrackPublication) => {
            if (publication.kind === Track.Kind.Audio) {
              publication.audioTrack?.attach();
            }
          },
        );
        room.on(RoomEvent.ConnectionQualityChanged, () => {
          setConnectionQuality('good');
        });

        await room.connect(livekit.url, livekit.token);
        await room.localParticipant.enableCameraAndMicrophone();
        const localVideo = room.localParticipant.getTrackPublication(Track.Source.Camera)
          ?.videoTrack as LocalVideoTrack | undefined;
        localVideoRef.current = localVideo ?? null;
        if (localVideo && videoElementRef.current) {
          localVideo.attach(videoElementRef.current);
        }

        snapshotTimerRef.current = window.setInterval(captureAndSendSnapshot, SNAPSHOT_INTERVAL_MS);

        const wsUrl = `${ORCHESTRATOR_BASE.replace(/^http/, 'ws')}${orchestrator.wsUrl}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnecting(false);
          setIsListening(true);
          ws.send(JSON.stringify({ type: 'start_turn' }));
          ws.send(JSON.stringify({ type: 'audio_chunk', data: '00'.repeat(320) }));
          ws.send(JSON.stringify({ type: 'end_turn' }));
        };
        ws.onmessage = handleOrchestratorMessage;
        ws.onerror = () => setError('Video connection error. Please try again.');
        ws.onclose = () => {
          setIsListening(false);
        };
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
      wsRef.current?.close();
      void roomRef.current?.disconnect();
      void audioContextRef.current?.close();
    };
  }, [sessionId, recoveryToken, handleOrchestratorMessage, captureAndSendSnapshot]);

  const handleToggleMute = () => {
    const audioTrack = roomRef.current?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.audioTrack;
    if (!audioTrack) return;
    if (audioTrack.isMuted) {
      void audioTrack.unmute();
      setIsMuted(false);
    } else {
      void audioTrack.mute();
      setIsMuted(true);
    }
  };

  const handleToggleCamera = () => {
    const videoTrack = localVideoRef.current;
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
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  connectionQuality === 'good' ? 'bg-success' : 'bg-warning'
                }`}
              />
              <span className="text-label-bold text-on-surface-variant">
                {connectionQuality === 'good' ? 'Connected' : 'Connecting…'}
              </span>
            </div>
          </div>
        </div>

        <Card padding="lg" radius="2xl">
          {aiText && (
            <div className="mb-6 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container">
                <Icon name="smart_toy" className="text-xl text-on-primary" />
              </div>
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                  Interviewer
                </p>
                <p className="mt-1 text-body-lg text-on-surface">{aiText}</p>
              </div>
            </div>
          )}

          <div className="relative overflow-hidden rounded-xl bg-surface-container-low">
            <video
              ref={videoElementRef}
              autoPlay
              playsInline
              muted
              className="aspect-video w-full object-cover"
            />
            {!isListening && (
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
