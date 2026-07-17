import { useEffect, useRef, useState } from 'react';
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
import { ApiErrorResponse, getLiveToken } from '../api';
import { loadRecovery, loadStoredSessionId, useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageShell } from '../components/PageShell';

export function HumanLivePage() {
  const navigate = useNavigate();
  const { session: contextSession, recoveryToken: contextRecoveryToken } = useInterview();
  const [recoveredSessionId, setRecoveredSessionId] = useState<string | null>(null);
  const [recoveredRecoveryToken, setRecoveredRecoveryToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'poor' | 'unknown'>(
    'unknown',
  );

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<LocalVideoTrack | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

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
    const liveSessionId = sessionId;
    const liveRecoveryToken = recoveryToken;
    let cancelled = false;

    async function startLive() {
      try {
        const tokenResponse = await getLiveToken(liveSessionId, liveRecoveryToken);
        if (cancelled) return;

        const { livekit } = tokenResponse;
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
        setConnecting(false);
      } catch (err) {
        setConnecting(false);
        setError(
          err instanceof ApiErrorResponse
            ? err.message
            : 'Could not join the live interview. Please try again.',
        );
      }
    }

    void startLive();

    return () => {
      cancelled = true;
      void roomRef.current?.disconnect();
    };
  }, [sessionId, recoveryToken]);

  const handleLeave = () => {
    void roomRef.current?.disconnect();
    navigate('/complete', { replace: true });
  };

  if (!sessionId || !recoveryToken) {
    return (
      <ErrorState
        title="Session not found"
        message="We could not find your interview session. Please open the invite link again."
      />
    );
  }

  if (connecting) return <LoadingState message="Joining your live interview…" />;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-headline-sm text-on-surface">Live interview</h1>
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

        <Card padding="lg" radius="2xl">
          <div className="mb-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            <Icon name="videocam" className="mr-2 inline" />
            This interview is being recorded. Continuing means you consent to recording.
          </div>

          <div className="relative overflow-hidden rounded-xl bg-surface-container-low">
            <video
              ref={videoElementRef}
              autoPlay
              playsInline
              muted
              className="aspect-video w-full object-cover"
            />
          </div>

          <p className="mt-4 text-body-md text-on-surface-variant">
            Waiting for the interviewer to join. Keep your camera and microphone on.
          </p>

          {error && (
            <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-end">
            <Button variant="outline" onClick={handleLeave} icon="call_end">
              Leave interview
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
