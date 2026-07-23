import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type DisconnectReason,
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
  const [recovering, setRecovering] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'poor' | 'unknown'>(
    'unknown',
  );
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  const roomRef = useRef<Room | null>(null);
  const localVideoTrackRef = useRef<LocalVideoTrack | null>(null);

  const [remoteVideoTrack, setRemoteVideoTrack] = useState<{
    track: RemoteTrack;
    participantIdentity: string;
  } | null>(null);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [interviewerJoined, setInterviewerJoined] = useState(false);

  // Callback refs attach the track as soon as the <video> element is mounted.
  // This avoids races where the track arrives before the DOM element is ready.
  const setRemoteVideoElement = useCallback(
    (node: HTMLVideoElement | null) => {
      if (node && remoteVideoTrack?.track) {
        remoteVideoTrack.track.attach(node);
      }
    },
    [remoteVideoTrack],
  );
  const setLocalVideoElement = useCallback(
    (node: HTMLVideoElement | null) => {
      if (node && localVideoTrack) {
        localVideoTrack.attach(node);
      }
    },
    [localVideoTrack],
  );

  const recoveryToken = contextRecoveryToken ?? recoveredRecoveryToken;
  const sessionId = contextSession?.id ?? recoveredSessionId;

  // Recover from sessionStorage if context was lost (refresh / direct navigation).
  useEffect(() => {
    if (contextSession && contextRecoveryToken) {
      setRecovering(false);
      return;
    }
    const storedSessionId = loadStoredSessionId();
    const storedRecoveryToken = storedSessionId ? loadRecovery(storedSessionId) : null;
    if (storedSessionId && storedRecoveryToken) {
      setRecoveredSessionId(storedSessionId);
      setRecoveredRecoveryToken(storedRecoveryToken);
    }
    setRecovering(false);
  }, [contextSession, contextRecoveryToken]);

  // Connect to LiveKit once we have session + recovery token.
  useEffect(() => {
    if (!sessionId || !recoveryToken) return;
    const liveSessionId = sessionId;
    const liveRecoveryToken = recoveryToken;
    let cancelled = false;
    setConnecting(true);
    setError(null);

    async function startLive() {
      try {
        const tokenResponse = await getLiveToken(liveSessionId, liveRecoveryToken);
        if (cancelled) return;

        const { livekit } = tokenResponse;
        console.log('[candidate] LiveKit token received, connecting to', livekit.url);

        const room = new Room({
          adaptiveStream: false,
          dynacast: false,
          disconnectOnPageLeave: false,
          reconnectPolicy: {
            nextRetryDelayInMs: (ctx) => {
              if (ctx.retryCount > 10) return null;
              return Math.min(1000 * 1.5 ** ctx.retryCount, 30000);
            },
          },
          publishDefaults: { simulcast: false },
        });
        roomRef.current = room;

        room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          console.log('[candidate] connection state:', state);
        });
        room.on(RoomEvent.SignalReconnecting, () => {
          console.log('[candidate] signal reconnecting');
          setIsReconnecting(true);
        });
        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, publication: RemoteTrackPublication, participant) => {
            console.log('[candidate] track subscribed', publication.kind, participant.identity);
            if (publication.kind === Track.Kind.Video) {
              setRemoteVideoTrack({ track, participantIdentity: participant.identity });
              setInterviewerJoined(true);
            } else if (publication.kind === Track.Kind.Audio) {
              track.attach();
            }
          },
        );
        room.on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, publication: RemoteTrackPublication) => {
            console.log('[candidate] track unsubscribed', publication.kind);
            if (publication.kind === Track.Kind.Video) {
              // Compare the actual track instance: when a participant reconnects,
              // the new track may arrive before the old track unsubscribes, and
              // identity-based cleanup would incorrectly clear the new track.
              setRemoteVideoTrack((current) => (current?.track === track ? null : current));
              track.detach();
            } else if (publication.kind === Track.Kind.Audio) {
              track.detach();
            }
          },
        );
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          console.log('[candidate] participant connected', participant.identity);
          setInterviewerJoined(true);
        });
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          console.log('[candidate] participant disconnected', participant.identity);
          setInterviewerJoined(false);
        });
        room.on(RoomEvent.ConnectionQualityChanged, (quality) => {
          console.log('[candidate] connection quality:', quality);
          setConnectionQuality(quality === 'excellent' || quality === 'good' ? 'good' : 'poor');
        });
        room.on(RoomEvent.Reconnecting, () => {
          console.log('[candidate] reconnecting');
          setIsReconnecting(true);
        });
        room.on(RoomEvent.Reconnected, () => {
          console.log('[candidate] reconnected');
          setIsReconnecting(false);
        });
        room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          console.log('[candidate] disconnected, reason:', reason);
          setIsReconnecting(false);
          setConnecting(false);
          setError(`Room disconnected (${reason ?? 'unknown'}). Please try again.`);
        });
        room.on(RoomEvent.LocalTrackPublished, (publication) => {
          console.log('[candidate] local track published', publication.kind);
          if (publication.kind === Track.Kind.Video && publication.videoTrack) {
            setLocalVideoTrack(publication.videoTrack);
          }
        });
        room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
          console.log('[candidate] local track unpublished', publication.kind);
          if (publication.kind === Track.Kind.Video) {
            setLocalVideoTrack(null);
          }
        });
        room.on(RoomEvent.MediaDevicesError, (err) => {
          console.error('[candidate] media devices error', err);
        });

        await room.connect(livekit.url, livekit.token, {
          rtcConfig: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          },
        });
        console.log('[candidate] room connected');
        await room.localParticipant.enableCameraAndMicrophone();
        console.log('[candidate] camera/mic enabled');
        const localVideo = room.localParticipant.getTrackPublication(Track.Source.Camera)
          ?.videoTrack as LocalVideoTrack | undefined;
        localVideoTrackRef.current = localVideo ?? null;
        setLocalVideoTrack(localVideo ?? null);
        setMicEnabled(room.localParticipant.isMicrophoneEnabled);
        setCameraEnabled(room.localParticipant.isCameraEnabled);
        setConnecting(false);
      } catch (err) {
        console.error('[candidate] startLive error', err);
        if (cancelled) return;
        setConnecting(false);
        setError(
          err instanceof ApiErrorResponse
            ? err.message
            : 'Could not join the live interview. Please check your camera/microphone permissions and try again.',
        );
      }
    }

    void startLive();

    return () => {
      cancelled = true;
      void roomRef.current?.disconnect();
    };
  }, [sessionId, recoveryToken]);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const publication = await room.localParticipant.setMicrophoneEnabled(!micEnabled);
    setMicEnabled(publication !== undefined);
  };

  const toggleCamera = async () => {
    const room = roomRef.current;
    if (!room) return;
    const publication = await room.localParticipant.setCameraEnabled(!cameraEnabled);
    setCameraEnabled(publication !== undefined);
  };

  const handleRetry = () => {
    setError(null);
    // Force a re-run of the connect effect by briefly clearing and restoring ids.
    if (contextSession?.id && contextRecoveryToken) {
      setConnecting(true);
      return;
    }
    const storedSessionId = loadStoredSessionId();
    const storedRecoveryToken = storedSessionId ? loadRecovery(storedSessionId) : null;
    if (storedSessionId && storedRecoveryToken) {
      setRecoveredSessionId(storedSessionId);
      setRecoveredRecoveryToken(storedRecoveryToken);
    }
  };

  const handleLeave = () => {
    void roomRef.current?.disconnect();
    navigate('/complete', { replace: true });
  };

  if (recovering) {
    return <LoadingState message="Restoring your session…" />;
  }

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
                isReconnecting
                  ? 'bg-warning animate-pulse'
                  : connectionQuality === 'good'
                    ? 'bg-success'
                    : 'bg-error'
              }`}
            />
            <span className="text-label-bold text-on-surface-variant">
              {isReconnecting
                ? 'Reconnecting…'
                : connectionQuality === 'good'
                  ? 'Connected'
                  : 'Poor connection'}
            </span>
          </div>
        </div>

        <Card padding="lg" radius="2xl">
          <div className="mb-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            <Icon name="videocam" className="mr-2 inline" />
            This interview is being recorded. Continuing means you consent to recording.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative overflow-hidden rounded-xl bg-surface-container-low aspect-video">
              <video
                ref={setRemoteVideoElement}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              {!remoteVideoTrack && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant p-4 text-center">
                  <Icon name="person" className="text-4xl mb-2" />
                  <p className="text-sm">Waiting for interviewer…</p>
                </div>
              )}
            </div>
            <div className="relative overflow-hidden rounded-xl bg-surface-container-low aspect-video">
              <video
                ref={setLocalVideoElement}
                autoPlay
                playsInline
                muted
                className={`absolute inset-0 w-full h-full object-cover ${!cameraEnabled ? 'hidden' : ''}`}
              />
              {!cameraEnabled && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant p-4 text-center">
                  <Icon name="videocam_off" className="text-4xl mb-2" />
                  <p className="text-sm">Camera is off</p>
                </div>
              )}
              <div className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-2">
                <span>You</span>
                {!micEnabled && <Icon name="mic_off" className="text-sm" />}
              </div>
            </div>
          </div>

          <p className="mt-4 text-body-md text-on-surface-variant">
            {interviewerJoined
              ? 'Interviewer joined. Keep your camera and microphone on.'
              : 'Waiting for the interviewer to join. Keep your camera and microphone on.'}
          </p>

          {error && (
            <div className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
              <p className="mb-2">{error}</p>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                Try again
              </Button>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={micEnabled ? 'mic' : 'mic_off'}
                onClick={() => void toggleMic()}
                aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
              >
                {micEnabled ? 'Mute' : 'Unmute'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={cameraEnabled ? 'videocam' : 'videocam_off'}
                onClick={() => void toggleCamera()}
                aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
              >
                {cameraEnabled ? 'Camera off' : 'Camera on'}
              </Button>
            </div>
            <Button variant="outline" onClick={handleLeave} icon="call_end">
              Leave interview
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
