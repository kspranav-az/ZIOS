import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import {
  ConnectionBadge,
  InterviewerBubble,
  connectRoomSession,
  openOrchestratorSocket,
  type ConnectionQuality,
  type OrchestratorConnection,
  type RoomSession,
} from '@zios/interview-room';
import { ApiErrorResponse, fallbackToText, getVoiceToken } from '../api';
import { loadRecovery, loadStoredSessionId, useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageShell } from '../components/PageShell';

const ORCHESTRATOR_BASE =
  (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'ws://localhost:8000';

export function VoiceInterviewPage() {
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
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>('unknown');
  const [fallbackLoading, setFallbackLoading] = useState(false);

  const sessionRef = useRef<RoomSession | null>(null);
  const connRef = useRef<OrchestratorConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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

  useEffect(() => {
    if (!sessionId || !recoveryToken) return;

    const token = recoveryToken as string;
    const sid = sessionId as string;
    let cancelled = false;

    async function startVoice() {
      try {
        const tokenResponse = await getVoiceToken(sid, token);
        if (cancelled) return;

        const { livekit, orchestrator } = tokenResponse;
        const roomSession = await connectRoomSession({
          url: livekit.url,
          token: livekit.token,
          onConnectionQuality: (quality) => setConnectionQuality(quality),
        });
        if (cancelled) {
          void roomSession.disconnect();
          return;
        }
        sessionRef.current = roomSession;

        const wsUrl = `${ORCHESTRATOR_BASE.replace(/^http/, 'ws')}${orchestrator.wsUrl}`;
        const conn = openOrchestratorSocket(wsUrl, {
          audioContext: audioContextRef,
          onCaption: setCaption,
          onAiText: setAiText,
          onError: setError,
          onBargeIn: () => setAiText(''),
          onOpen: () => {
            setConnecting(false);
            // Elicit the first question: an empty bootstrap turn makes the
            // conductor re-present the current question with TTS.
            conn.sendStartTurn();
            conn.sendEndTurn();
          },
          onAwaitingAnswer: () => {
            void conn.mic.start().then((live) => {
              if (live) setIsListening(true);
            });
          },
          onInterviewComplete: () => {
            setIsListening(false);
            navigate('/complete', { replace: true });
          },
          onClose: () => setIsListening(false),
          onTransportError: () => setError('Voice connection error. Please try again.'),
        });
        connRef.current = conn;
      } catch (err) {
        setConnecting(false);
        setError(
          err instanceof ApiErrorResponse
            ? err.message
            : 'Could not start voice interview. Please try again.',
        );
      }
    }

    void startVoice();

    return () => {
      cancelled = true;
      connRef.current?.mic.stop();
      connRef.current?.close();
      void sessionRef.current?.disconnect();
      void audioContextRef.current?.close();
    };
  }, [sessionId, recoveryToken]);

  const handleToggleMute = () => {
    const track = sessionRef.current?.localAudioTrack;
    if (!track) return;
    if (track.isMuted) {
      void track.unmute();
      setIsMuted(false);
      if (isListening) void connRef.current?.mic.start();
    } else {
      void track.mute();
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

  if (connecting) return <LoadingState message="Starting your voice interview…" />;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-headline-sm text-on-surface">Voice interview</h1>
          <ConnectionBadge quality={connectionQuality} />
        </div>

        <Card padding="lg" radius="2xl">
          <InterviewerBubble text={aiText} />

          <div className="rounded-xl bg-surface-container-low p-6 text-center">
            <div
              className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full ${
                isListening ? 'bg-primary/10 animate-pulse' : 'bg-surface-container'
              }`}
            >
              <Icon name={isListening ? 'mic' : 'mic_off'} className="text-3xl text-primary" />
            </div>
            <p className="text-body-md text-on-surface-variant">
              {isListening ? 'Listening…' : 'Processing…'}
            </p>
            {caption && <p className="mt-2 text-body-lg text-on-surface">“{caption}”</p>}
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={handleToggleMute} icon={isMuted ? 'mic_off' : 'mic'}>
              {isMuted ? 'Unmute' : 'Mute'}
            </Button>
            {isListening && (
              <Button variant="primary" onClick={handleSendAnswer} icon="send">
                Send answer
              </Button>
            )}
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
