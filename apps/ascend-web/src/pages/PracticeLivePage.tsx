import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import {
  ApiErrorResponse,
  abandonPractice,
  clearPracticeRecovery,
  fetchPracticeSession,
  getPracticeLiveToken,
  loadPracticeRecovery,
  preflightPractice,
} from '../api';
import { PageShell } from '../components/PageShell';

const ORCHESTRATOR_BASE =
  (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'ws://localhost:8000';

const COMPLETION_POLL_MS = 4000;

/**
 * Live practice room (Phase 12e): the real LiveKit interview experience —
 * camera + mic + an orchestrator AI interviewer — backed by the practice
 * engine (same questions, judging and report as text/voice mocks). Immersive
 * route (no app chrome), mirroring the candidate-web interview pages.
 *
 * The session is charged + transitioned to live by preflight (same contract
 * as the other modes); completion is detected by polling the session detail,
 * then the candidate lands on the existing practice report.
 */
export function PracticeLivePage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [aiText, setAiText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>('unknown');
  const [leaving, setLeaving] = useState(false);

  const sessionRef = useRef<RoomSession | null>(null);
  const connRef = useRef<OrchestratorConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  /** Set once we navigate away (poll → report / close → text handoff). */
  const finishedRef = useRef(false);

  const recoveryToken = loadPracticeRecovery(sessionId);

  useEffect(() => {
    if (!recoveryToken) return;
    let cancelled = false;

    async function startLive() {
      try {
        // Preflight is idempotent: on 'live' sessions it returns the current
        // turn without double-charging; here it performs the initial
        // consent-gated live transition + credit debit.
        await preflightPractice(sessionId, recoveryToken as string);
        const tokenResponse = await getPracticeLiveToken(sessionId, recoveryToken as string);
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
            // AI finished speaking — open the mic and listen for the answer.
            void conn.mic.start().then((live) => {
              if (live) setIsListening(true);
            });
          },
          onInterviewComplete: () => {
            finishedRef.current = true;
            clearPracticeRecovery(sessionId);
            navigate(`/practice/${sessionId}/report`, { replace: true });
          },
          onClose: () => {
            setIsListening(false);
            // Hand the mock back to the text conductor UI for the remaining
            // questions (unless completion already routed to the report).
            if (!finishedRef.current) {
              finishedRef.current = true;
              navigate(`/practice/${sessionId}/interview?room=done`, { replace: true });
            }
          },
          onTransportError: () => setError('Live room connection error. Please try again.'),
        });
        connRef.current = conn;
      } catch (err) {
        setConnecting(false);
        setError(
          err instanceof ApiErrorResponse
            ? err.message
            : 'Could not start the live room. Please try again.',
        );
      }
    }

    void startLive();

    return () => {
      cancelled = true;
      connRef.current?.mic.stop();
      connRef.current?.close();
      void sessionRef.current?.disconnect();
      void audioContextRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session-scoped one-shot connect
  }, [sessionId, recoveryToken]);

  // Completion poll: the orchestrator drives turns through the practice
  // conductor routes; when questions wrap up the session becomes 'completed'
  // and judging runs — then we route to the report.
  useEffect(() => {
    if (connecting || error) return;
    const timer = window.setInterval(() => {
      fetchPracticeSession(sessionId)
        .then((detail) => {
          if (detail.session.status === 'completed' && !finishedRef.current) {
            finishedRef.current = true;
            clearPracticeRecovery(sessionId);
            window.clearInterval(timer);
            navigate(`/practice/${sessionId}/report`, { replace: true });
          }
        })
        .catch(() => {
          // Polling is best-effort; connection-state UX carries the signal.
        });
    }, COMPLETION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [sessionId, connecting, error, navigate]);

  const handleToggleMute = () => {
    const track = sessionRef.current?.localAudioTrack;
    if (!track) return;
    if (track.isMuted) {
      void track.unmute();
      setIsMuted(false);
      // Resume streaming the answer if the room is waiting for one.
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
    // Close the candidate turn; the orchestrator transcribes and replies.
    conn.sendEndTurn();
  };

  const handleLeave = async () => {
    setLeaving(true);
    finishedRef.current = true;
    try {
      await abandonPractice(sessionId, recoveryToken ?? '');
    } catch {
      // Abandon is best-effort; local cleanup below always runs.
    } finally {
      clearPracticeRecovery(sessionId);
      navigate('/practice', { replace: true });
    }
  };

  if (!recoveryToken) {
    return (
      <PageShell>
        <div className="mx-auto w-full max-w-2xl text-center">
          <h1 className="text-headline-sm text-on-surface">Session not found</h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            We could not find your practice session. Please start a new mock.
          </p>
        </div>
      </PageShell>
    );
  }

  if (connecting) {
    return (
      <PageShell>
        <div className="mx-auto w-full max-w-2xl text-center">
          <p className="text-body-lg text-on-surface-variant">Starting your live practice room…</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-headline-sm text-on-surface">Live practice</h1>
          <ConnectionBadge quality={connectionQuality} />
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
            {!isListening && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <p className="text-body-md text-white">Processing…</p>
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
              onClick={() => void handleLeave()}
              loading={leaving}
              icon="call_end"
            >
              End session
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
