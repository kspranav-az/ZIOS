import {
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';

export type ConnectionQuality = 'good' | 'poor' | 'unknown';

export interface ConnectRoomSessionOptions {
  url: string;
  token: string;
  /** When provided, the camera track is attached to this element after connect. */
  videoElement?: HTMLVideoElement | null;
  onConnectionQuality?: (quality: ConnectionQuality) => void;
  /**
   * Camera unavailable (denied, in use by another app, or no device): the
   * room continues audio-only. Surface this to the candidate — a silently
   * black video tile reads as a bug.
   */
  onCameraWarning?: (message: string) => void;
}

export interface RoomSession {
  room: Room;
  localAudioTrack: LocalAudioTrack | null;
  localVideoTrack: LocalVideoTrack | null;
  disconnect: () => Promise<void>;
}

/**
 * Connect a candidate room: publish mic (+camera), attach remote audio
 * automatically, surface connection quality. Mirrors the setup both
 * candidate-web interview pages performed inline before extraction.
 */
export async function connectRoomSession(
  opts: ConnectRoomSessionOptions,
): Promise<RoomSession> {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: { simulcast: false },
  });

  room.on(
    RoomEvent.TrackSubscribed,
    (_track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (publication.kind === Track.Kind.Audio) {
        publication.audioTrack?.attach();
      }
    },
  );
  room.on(RoomEvent.ConnectionQualityChanged, () => {
    opts.onConnectionQuality?.('good');
  });

  await room.connect(opts.url, opts.token);
  let cameraFailed = false;
  const wantsCamera = Boolean(opts.videoElement);
  try {
    if (wantsCamera) {
      await room.localParticipant.enableCameraAndMicrophone();
    } else {
      // Voice-only rooms must not require a camera — requesting one here
      // would fail the whole connect on a camera-less or denied setup.
      await room.localParticipant.setMicrophoneEnabled(true);
    }
  } catch {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      // Mic failure surfaces via the orchestrator/socket error path.
    }
    if (wantsCamera) {
      cameraFailed = true;
      // Fall back to mic-only so the interview still runs; warn loudly —
      // a silently black video tile reads as a bug.
      opts.onCameraWarning?.(
        'Camera unavailable — continuing with audio only. Check the browser camera permission.',
      );
    }
  }

  const localAudioTrack =
    (room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as
      | LocalAudioTrack
      | undefined) ?? null;
  const localVideoTrack = cameraFailed
    ? null
    : ((room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as
        | LocalVideoTrack
        | undefined) ?? null);
  if (localVideoTrack && opts.videoElement) {
    localVideoTrack.attach(opts.videoElement);
  }

  return {
    room,
    localAudioTrack,
    localVideoTrack,
    disconnect: async () => {
      await room.disconnect();
    },
  };
}
