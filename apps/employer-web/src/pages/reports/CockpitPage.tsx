import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CockpitStateResponse, SessionCoverage, SessionTranscript } from '@zios/shared-types';
import { Badge, Button, Card, Icon } from '@zios/ui';
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
import { useToast } from '../../components/Toast';
import { userMessageForError } from '../../lib/errors';
import * as liveRoomsApi from '../../lib/live-rooms-api';

/** /interviews/:sessionId/cockpit — interviewer live room + kit cockpit (Phase 09). */

type CoverageMap = Map<string, SessionCoverage>;

interface TimerState {
  remainingSec: number;
  running: boolean;
}

export function CockpitPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { push: showToast } = useToast();

  const [state, setState] = useState<CockpitStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [coverage, setCoverage] = useState<CoverageMap>(new Map());
  const [transcript, setTranscript] = useState<SessionTranscript[]>([]);
  const [notes, setNotes] = useState<CockpitStateResponse['notes']>(null);
  const [ending, setEnding] = useState(false);

  const [remoteVideoTrack, setRemoteVideoTrack] = useState<{
    track: RemoteTrack;
    participantIdentity: string;
  } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting',
  );
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'poor' | 'unknown'>(
    'unknown',
  );
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [roomError, setRoomError] = useState<string>();
  const [connectNonce, setConnectNonce] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);

  const roomRef = useRef<Room | null>(null);
  const timersRef = useRef<Map<string, TimerState>>(new Map());
  const [, forceRender] = useState(0);

  // Callback refs attach the track as soon as the <video> element is mounted.
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

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(undefined);
    try {
      const cockpit = await liveRoomsApi.getCockpitState(sessionId);
      setState(cockpit);
      setTranscript(cockpit.transcript);
      setNotes(cockpit.notes);
      setCoverage(new Map(cockpit.coverage.map((c) => [c.questionId, c])));
      for (const question of cockpit.kit.questions) {
        if (!timersRef.current.has(question.id)) {
          timersRef.current.set(question.id, {
            remainingSec: question.timeLimitSec ?? 120,
            running: false,
          });
        }
      }
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---- LiveKit room ---- */
  useEffect(() => {
    if (!sessionId || !state) return;
    setConnectionStatus('connecting');
    setRoomError(undefined);
    let cancelled = false;

    async function connect() {
      try {
        const tokenResponse = await liveRoomsApi.issueInterviewerToken(sessionId!);
        if (cancelled) return;

        console.log(
          '[interviewer] LiveKit token received, connecting to',
          tokenResponse.livekit.url,
        );

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
          console.log('[interviewer] connection state:', state);
        });
        room.on(RoomEvent.SignalReconnecting, () => {
          console.log('[interviewer] signal reconnecting');
          setIsReconnecting(true);
        });
        room.on(
          RoomEvent.TrackSubscribed,
          (
            track: RemoteTrack,
            publication: RemoteTrackPublication,
            participant: { identity: string },
          ) => {
            console.log('[interviewer] track subscribed', publication.kind, participant.identity);
            if (publication.kind === Track.Kind.Video) {
              setRemoteVideoTrack({ track, participantIdentity: participant.identity });
            } else if (publication.kind === Track.Kind.Audio) {
              track.attach();
            }
          },
        );

        room.on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, publication: RemoteTrackPublication) => {
            console.log('[interviewer] track unsubscribed', publication.kind);
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

        room.on(RoomEvent.Connected, () => {
          console.log('[interviewer] connected');
          setConnectionStatus('connected');
          setIsReconnecting(false);
        });
        room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          console.log('[interviewer] disconnected, reason:', reason);
          setConnectionStatus('error');
          setIsReconnecting(false);
          setRoomError(`Disconnected (${reason ?? 'unknown'})`);
        });
        room.on(RoomEvent.Reconnecting, () => {
          console.log('[interviewer] reconnecting');
          setIsReconnecting(true);
        });
        room.on(RoomEvent.Reconnected, () => {
          console.log('[interviewer] reconnected');
          setConnectionStatus('connected');
          setIsReconnecting(false);
          setRoomError(undefined);
        });
        room.on(RoomEvent.ConnectionQualityChanged, (quality) => {
          console.log('[interviewer] connection quality:', quality);
          setConnectionQuality(quality === 'excellent' || quality === 'good' ? 'good' : 'poor');
        });
        room.on(RoomEvent.LocalTrackPublished, (publication) => {
          console.log('[interviewer] local track published', publication.kind);
          if (publication.kind === Track.Kind.Video && publication.videoTrack) {
            setLocalVideoTrack(publication.videoTrack);
          }
        });
        room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
          console.log('[interviewer] local track unpublished', publication.kind);
          if (publication.kind === Track.Kind.Video) {
            setLocalVideoTrack(null);
          }
        });
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          console.log('[interviewer] participant connected', participant.identity);
        });
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          console.log('[interviewer] participant disconnected', participant.identity);
        });
        room.on(RoomEvent.MediaDevicesError, (err) => {
          console.error('[interviewer] media devices error', err);
        });

        await room.connect(tokenResponse.livekit.url, tokenResponse.livekit.token, {
          rtcConfig: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          },
        });
        console.log('[interviewer] room.connect resolved');
        await room.localParticipant.enableCameraAndMicrophone();
        console.log('[interviewer] camera/mic enabled');
        const localVideo = room.localParticipant.getTrackPublication(Track.Source.Camera)
          ?.videoTrack as LocalVideoTrack | undefined;
        if (localVideo) {
          setLocalVideoTrack(localVideo);
        }
        setMicEnabled(room.localParticipant.isMicrophoneEnabled);
        setCameraEnabled(room.localParticipant.isCameraEnabled);
      } catch (err) {
        console.error('[interviewer] connect error', err);
        if (cancelled) return;
        setConnectionStatus('error');
        setRoomError(err instanceof Error ? err.message : 'Could not connect to the video room.');
      }
    }

    void connect();

    return () => {
      cancelled = true;
      void roomRef.current?.disconnect();
    };
  }, [sessionId, state?.session.id, connectNonce]);

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

  /* ---- timers ---- */
  useEffect(() => {
    const interval = window.setInterval(() => {
      let changed = false;
      for (const timer of timersRef.current.values()) {
        if (timer.running && timer.remainingSec > 0) {
          timer.remainingSec -= 1;
          changed = true;
        }
      }
      if (changed) forceRender((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleTimer = (questionId: string) => {
    const timer = timersRef.current.get(questionId);
    if (!timer) return;
    timer.running = !timer.running;
    forceRender((n) => n + 1);
  };

  const resetTimer = (questionId: string) => {
    const question = state?.kit.questions.find((q) => q.id === questionId);
    if (!question) return;
    const timer = timersRef.current.get(questionId);
    if (!timer) return;
    timer.remainingSec = question.timeLimitSec ?? 120;
    timer.running = false;
    forceRender((n) => n + 1);
  };

  /* ---- coverage ---- */
  const markCoverage = async (questionId: string, action: 'cover' | 'skip' | 'reset') => {
    if (!sessionId) return;
    try {
      const response = await liveRoomsApi.markCoverage(sessionId, { questionId, action });
      setCoverage(new Map(response.coverage.map((c) => [c.questionId, c])));
    } catch (err) {
      showToast(userMessageForError(err), 'error');
    }
  };

  /* ---- end call ---- */
  const handleEndCall = async () => {
    if (!sessionId) return;
    setEnding(true);
    try {
      await liveRoomsApi.endLiveCall(sessionId);
      void roomRef.current?.disconnect();
      showToast('Interview ended. Fill out the scorecard.', 'success');
      navigate(`/interviews/${sessionId}/scorecard`);
    } catch (err) {
      showToast(userMessageForError(err), 'error');
      setEnding(false);
    }
  };

  /* ---- transcript polling ---- */
  useEffect(() => {
    if (!sessionId || !state) return;
    if (state.session.status !== 'live') return;
    const interval = window.setInterval(() => {
      liveRoomsApi
        .getCockpitState(sessionId)
        .then((cockpit) => {
          setTranscript(cockpit.transcript);
          setNotes(cockpit.notes);
          setCoverage(new Map(cockpit.coverage.map((c) => [c.questionId, c])));
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [sessionId, state]);

  const coverageCounts = useMemo(() => {
    const values = Array.from(coverage.values());
    return {
      covered: values.filter((c) => c.status === 'covered').length,
      skipped: values.filter((c) => c.status === 'skipped').length,
      pending: values.filter((c) => c.status === 'pending').length,
      total: values.length,
    };
  }, [coverage]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-12 animate-pulse">
          <div className="h-8 w-1/3 bg-surface-container rounded mb-4" />
          <div className="h-64 w-full bg-surface-container rounded" />
        </Card>
      </div>
    );
  }

  if (error || !state || !sessionId) {
    return (
      <div className="max-w-container-max mx-auto">
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name="error" className="text-2xl text-error" />
          </div>
          <p className="font-label-bold text-label-bold text-primary">Could not load cockpit</p>
          <p className="text-sm text-on-surface-variant">{error ?? 'Unknown error'}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-container-max mx-auto space-y-4">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
            {state.candidate.name}
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
            {state.candidate.email} · {state.kit.kit.title}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            tone={
              connectionStatus === 'error'
                ? 'error'
                : isReconnecting
                  ? 'warning'
                  : connectionQuality === 'good'
                    ? 'success'
                    : 'warning'
            }
          >
            {isReconnecting
              ? 'Reconnecting…'
              : connectionStatus === 'connected'
                ? connectionQuality === 'good'
                  ? 'Live'
                  : 'Poor connection'
                : connectionStatus === 'connecting'
                  ? 'Connecting…'
                  : 'Room offline'}
          </Badge>
          <Button
            variant="outline"
            icon={micEnabled ? 'mic' : 'mic_off'}
            onClick={() => void toggleMic()}
            disabled={connectionStatus !== 'connected'}
            aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {micEnabled ? 'Mute' : 'Unmute'}
          </Button>
          <Button
            variant="outline"
            icon={cameraEnabled ? 'videocam' : 'videocam_off'}
            onClick={() => void toggleCamera()}
            disabled={connectionStatus !== 'connected'}
            aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {cameraEnabled ? 'Camera off' : 'Camera on'}
          </Button>
          <Button icon="call_end" onClick={handleEndCall} loading={ending}>
            End call
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Video + transcript */}
        <div className="lg:col-span-2 space-y-4">
          <Card padding="none" radius="2xl" className="overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-surface-variant/50">
              <div className="aspect-video bg-surface-container-lowest relative">
                {connectionStatus === 'error' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant p-4 text-center">
                    <Icon name="videocam_off" className="text-4xl mb-2" />
                    <p className="text-sm">Could not connect to video room.</p>
                    {roomError && <p className="text-xs mt-1 max-w-xs">{roomError}</p>}
                    <p className="text-xs mt-1">Cockpit controls still work.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => setConnectNonce((n) => n + 1)}
                    >
                      Retry connection
                    </Button>
                  </div>
                ) : (
                  <video
                    ref={setRemoteVideoElement}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                {!remoteVideoTrack && connectionStatus !== 'error' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant p-4 text-center">
                    <Icon name="person" className="text-4xl mb-2" />
                    <p className="text-sm">Waiting for candidate…</p>
                  </div>
                )}
              </div>
              <div className="aspect-video bg-surface-container-lowest relative">
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
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-headline-sm text-headline-sm text-primary">Live transcript</h3>
              <span className="text-xs text-on-surface-variant">{transcript.length} entries</span>
            </div>
            <div className="max-h-64 overflow-auto space-y-3">
              {transcript.length === 0 ? (
                <p className="text-sm text-on-surface-variant">Transcript will appear here.</p>
              ) : (
                transcript.map((t) => (
                  <div key={t.id} className="p-3 rounded-xl bg-surface-container-low">
                    <p className="text-sm font-label-bold text-primary">{t.questionPrompt}</p>
                    <p className="text-sm text-on-surface whitespace-pre-wrap">
                      {t.answerText ?? (
                        <span className="italic text-on-surface-variant">No answer yet</span>
                      )}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>

          {notes && (
            <Card>
              <h3 className="font-headline-sm text-headline-sm text-primary mb-3">Auto-notes</h3>
              <p className="text-sm text-on-surface whitespace-pre-wrap">{notes.summary}</p>
            </Card>
          )}
        </div>

        {/* Kit + coverage */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline-sm text-headline-sm text-primary">Coverage</h3>
              <span className="text-sm text-on-surface-variant">
                {coverageCounts.covered + coverageCounts.skipped}/{coverageCounts.total}
              </span>
            </div>
            <div className="w-full bg-surface-container rounded-full h-2 mb-4">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{
                  width: `${coverageCounts.total > 0 ? ((coverageCounts.covered + coverageCounts.skipped) / coverageCounts.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="flex gap-3 text-xs text-on-surface-variant">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-success" />
                Covered {coverageCounts.covered}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-warning" />
                Skipped {coverageCounts.skipped}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-surface-variant" />
                Pending {coverageCounts.pending}
              </span>
            </div>
          </Card>

          <Card>
            <h3 className="font-headline-sm text-headline-sm text-primary mb-4">Kit questions</h3>
            <div className="space-y-4">
              {state.kit.questions.map((question) => {
                const status = coverage.get(question.id)?.status ?? 'pending';
                const timer = timersRef.current.get(question.id) ?? {
                  remainingSec: question.timeLimitSec ?? 120,
                  running: false,
                };
                return (
                  <div
                    key={question.id}
                    className="border border-surface-variant/50 rounded-2xl p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-label-bold text-primary text-sm">{question.prompt}</p>
                        <p className="text-xs text-on-surface-variant mt-1">
                          {question.topic} · {question.difficulty}
                        </p>
                      </div>
                      <Badge
                        tone={
                          status === 'covered'
                            ? 'success'
                            : status === 'skipped'
                              ? 'warning'
                              : 'neutral'
                        }
                        className="text-[10px] capitalize"
                      >
                        {status}
                      </Badge>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <div
                        className={`font-mono text-sm px-3 py-1.5 rounded-lg ${
                          timer.remainingSec === 0
                            ? 'bg-error-container text-on-error-container'
                            : 'bg-surface-container text-primary'
                        }`}
                      >
                        {formatTime(timer.remainingSec)}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleTimer(question.id)}
                        className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant"
                        aria-label={timer.running ? 'Pause timer' : 'Start timer'}
                      >
                        <Icon name={timer.running ? 'pause' : 'play_arrow'} className="text-sm" />
                      </button>
                      <button
                        type="button"
                        onClick={() => resetTimer(question.id)}
                        className="p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant"
                        aria-label="Reset timer"
                      >
                        <Icon name="replay" className="text-sm" />
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant={status === 'covered' ? 'primary' : 'outline'}
                        size="sm"
                        onClick={() => markCoverage(question.id, 'cover')}
                      >
                        Cover
                      </Button>
                      <Button
                        variant={status === 'skipped' ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => markCoverage(question.id, 'skip')}
                      >
                        Skip
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => markCoverage(question.id, 'reset')}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
