"""LiveKit recorder participant for AI-conducted video-mode interviews.

Joins the session's LiveKit room as a hidden, subscribe-only participant
(``recorder-{session_id}``), consumes the candidate's camera and microphone
tracks, and feeds them into a WebmEncoder. The capture is deliberately
fail-safe: every error is logged and swallowed so a capture failure can never
break the interview itself.

Frame/sample consumption is decoupled from the LiveKit SDK: the consumer
methods accept plain async iterators of frame events so tests can drive the
capture with synthetic media, and only ``start`` touches the network.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from typing import Any, Protocol

import structlog
from livekit import api, rtc

from app.video.encoder import WebmEncoder

logger = structlog.get_logger()

CAPTURE_SAMPLE_RATE = 48000
CAPTURE_CHANNELS = 1


class _VideoFrameEvent(Protocol):
    """Structural shape of rtc.video_stream.FrameEvent (RGB24 format)."""

    frame: Any  # rtc.VideoFrame: .data (memoryview), .width, .height


class _AudioFrameEvent(Protocol):
    """Structural shape of rtc.audio_stream.AudioFrameEvent."""

    frame: Any  # rtc.AudioFrame: .data, .sample_rate, .num_channels


class VideoCaptureSession:
    """Captures one candidate's LiveKit tracks and encodes them to WebM."""

    def __init__(
        self,
        session_id: str,
        room_name: str,
        livekit_url: str,
        api_key: str,
        api_secret: str,
        encoder: WebmEncoder | None = None,
    ) -> None:
        self.session_id = session_id
        self.room_name = room_name
        self.livekit_url = livekit_url
        self.api_key = api_key
        self.api_secret = api_secret
        self.encoder = encoder or WebmEncoder()
        self._room: rtc.Room | None = None
        self._consumers: set[asyncio.Task[None]] = set()

    def _recorder_token(self) -> str:
        """Hidden, subscribe-only token; the recorder is invisible to participants."""
        return (
            api.AccessToken(self.api_key, self.api_secret)
            .with_identity(f"recorder-{self.session_id}")
            .with_name("Recorder")
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=self.room_name,
                    can_publish=False,
                    can_subscribe=True,
                    hidden=True,
                )
            )
            .to_jwt()
        )

    async def start(self) -> None:
        """Connect to the room and subscribe to the candidate's tracks."""
        room = rtc.Room()
        room.on("track_subscribed", self._on_track_subscribed)
        await room.connect(self.livekit_url, self._recorder_token())
        self._room = room
        logger.info(
            "video_capture_started",
            session_id=self.session_id,
            room_name=self.room_name,
        )

    def _on_track_subscribed(
        self,
        track: rtc.RemoteTrack,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        # Only the candidate's media is captured; never other recorder or AI
        # participants that might share the room.
        if not participant.identity.startswith("candidate-"):
            return
        if track.kind == rtc.TrackKind.KIND_VIDEO:
            stream: AsyncIterator[Any] = rtc.VideoStream(
                track,
                format=rtc.VideoBufferType.RGB24,
            )
            self._spawn(self._consume_video(stream))
        elif track.kind == rtc.TrackKind.KIND_AUDIO:
            audio_stream: AsyncIterator[Any] = rtc.AudioStream(
                track,
                sample_rate=CAPTURE_SAMPLE_RATE,
                num_channels=CAPTURE_CHANNELS,
            )
            self._spawn(self._consume_audio(audio_stream))

    def _spawn(self, coro: Any) -> None:
        task: asyncio.Task[None] = asyncio.create_task(coro)
        self._consumers.add(task)
        task.add_done_callback(self._consumers.discard)

    async def _consume_video(self, stream: AsyncIterator[_VideoFrameEvent]) -> None:
        """Feed RGB24 frames from a video stream into the encoder."""
        try:
            async for event in stream:
                frame = event.frame
                await self.encoder.add_video_frame(bytes(frame.data), frame.width, frame.height)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "video_capture_video_consumer_failed",
                session_id=self.session_id,
                error=str(exc),
            )

    async def _consume_audio(self, stream: AsyncIterator[_AudioFrameEvent]) -> None:
        """Feed PCM16 samples from an audio stream into the encoder."""
        try:
            async for event in stream:
                frame = event.frame
                await self.encoder.add_audio_frame(
                    bytes(frame.data), frame.sample_rate, frame.num_channels
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "video_capture_audio_consumer_failed",
                session_id=self.session_id,
                error=str(exc),
            )

    async def stop(self) -> bytes | None:
        """Disconnect, cancel consumers, and finalize the encode.

        Returns the WebM bytes, or None when no usable video was captured
        (the caller then falls back to the audio-only recording path).
        """
        if self._room is not None:
            try:
                await self._room.disconnect()
            except Exception as exc:
                logger.warning(
                    "video_capture_disconnect_failed",
                    session_id=self.session_id,
                    error=str(exc),
                )
            self._room = None
        for task in self._consumers:
            task.cancel()
        if self._consumers:
            await asyncio.gather(*self._consumers, return_exceptions=True)
        self._consumers.clear()
        webm = await self.encoder.finalize()
        logger.info(
            "video_capture_stopped",
            session_id=self.session_id,
            video_frames=self.encoder.stats.video_frames,
            video_frames_dropped=self.encoder.stats.video_frames_dropped,
            audio_bytes=self.encoder.stats.audio_bytes,
            encoded_bytes=len(webm) if webm else 0,
        )
        return webm


def capture_enabled() -> bool:
    """VIDEO_MODE_CAPTURE env flag (default true)."""
    return os.environ.get("VIDEO_MODE_CAPTURE", "true").lower() == "true"
