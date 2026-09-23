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
  await room.localParticipant.enableCameraAndMicrophone();

  const localAudioTrack =
    (room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as
      | LocalAudioTrack
      | undefined) ?? null;
  const localVideoTrack =
    (room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as
      | LocalVideoTrack
      | undefined) ?? null;
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
