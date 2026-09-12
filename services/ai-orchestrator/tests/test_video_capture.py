"""Tests for video-mode capture: WebM encoder, capture session, router wiring."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from app.video.capture import VideoCaptureSession
from app.video.encoder import WebmEncoder
from app.voice.mock_stt import MockSttAdapter
from app.voice.mock_tts import MockTtsAdapter
from app.voice.router import _persist_recording
from app.voice.service import VoiceSessionService
from tests.test_voice_service import FakeConductor

FFMPEG_REQUIRED = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _rgb_frame(width: int, height: int, seed: int = 0) -> bytes:
    """Synthetic RGB24 frame with a vertical gradient."""
    rng = np.random.default_rng(seed)
    return rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8).tobytes()


def _sine_pcm(seconds: float, sample_rate: int = 48000) -> bytes:
    """Synthetic mono PCM16 sine wave."""
    t = np.linspace(0, seconds, int(sample_rate * seconds), endpoint=False)
    samples = (np.sin(2 * np.pi * 440 * t) * 16000).astype(np.int16)
    return samples.tobytes()


def _ffprobe_streams(path: str) -> str:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height",
            "-of",
            "csv=p=0",
            path,
        ],
        capture_output=True,
        check=True,
    )
    return result.stdout.decode()


async def _probe_webm(webm: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(webm)
        path = f.name
    try:
        return _ffprobe_streams(path)
    finally:
        os.remove(path)


@FFMPEG_REQUIRED
@pytest.mark.asyncio
async def test_encoder_produces_webm_with_video_and_audio() -> None:
    encoder = WebmEncoder(fps=10)
    for i in range(10):
        await encoder.add_video_frame(_rgb_frame(320, 240, seed=i), 320, 240)
    await encoder.add_audio_frame(_sine_pcm(1.0), 48000, 1)

    webm = await encoder.finalize()

    assert webm is not None
    streams = await _probe_webm(webm)
    assert "vp8,video" in streams
    assert "opus,audio" in streams


@FFMPEG_REQUIRED
@pytest.mark.asyncio
async def test_encoder_produces_video_only_webm_without_audio() -> None:
    encoder = WebmEncoder(fps=10)
    for i in range(5):
        await encoder.add_video_frame(_rgb_frame(160, 120, seed=i), 160, 120)

    webm = await encoder.finalize()

    assert webm is not None
    streams = await _probe_webm(webm)
    assert "vp8,video" in streams
    assert "audio" not in streams


@FFMPEG_REQUIRED
@pytest.mark.asyncio
async def test_encoder_downscales_to_max_width() -> None:
    encoder = WebmEncoder(fps=10, max_width=854)
    await encoder.add_video_frame(_rgb_frame(1280, 720), 1280, 720)

    webm = await encoder.finalize()

    assert webm is not None
    streams = await _probe_webm(webm)
    assert "854" in streams and "480" in streams


@FFMPEG_REQUIRED
@pytest.mark.asyncio
async def test_encoder_returns_none_without_video_frames() -> None:
    """Audio-only input yields no WebM so callers fall back to the WAV path."""
    encoder = WebmEncoder()
    await encoder.add_audio_frame(_sine_pcm(0.5), 48000, 1)

    assert await encoder.finalize() is None


@FFMPEG_REQUIRED
@pytest.mark.asyncio
async def test_encoder_downmixes_stereo_audio() -> None:
    encoder = WebmEncoder(fps=10)
    await encoder.add_video_frame(_rgb_frame(160, 120), 160, 120)
    mono = np.frombuffer(_sine_pcm(0.5), dtype=np.int16)
    stereo = np.stack([mono, mono], axis=1).astype(np.int16).tobytes()
    await encoder.add_audio_frame(stereo, 48000, 2)

    webm = await encoder.finalize()

    assert webm is not None
    assert "opus,audio" in await _probe_webm(webm)
    assert encoder.stats.audio_bytes == len(mono.tobytes())


@pytest.mark.asyncio
async def test_encoder_skips_non_48khz_audio() -> None:
    encoder = WebmEncoder()
    await encoder.add_audio_frame(_sine_pcm(0.5, 16000), 16000, 1)
    assert encoder.stats.audio_bytes == 0


def _fake_video_events(count: int, width: int = 160, height: int = 120) -> AsyncIterator[Any]:
    async def _gen() -> AsyncIterator[Any]:
        for i in range(count):
            frame = SimpleNamespace(
                data=memoryview(_rgb_frame(width, height, seed=i)),
                width=width,
                height=height,
            )
            yield SimpleNamespace(frame=frame)

    return _gen()


def _fake_audio_events(chunks: int, sample_rate: int = 48000) -> AsyncIterator[Any]:
    async def _gen() -> AsyncIterator[Any]:
        for _ in range(chunks):
            frame = SimpleNamespace(
                data=memoryview(_sine_pcm(0.1, sample_rate)),
                sample_rate=sample_rate,
                num_channels=1,
            )
            yield SimpleNamespace(frame=frame)

    return _gen()


@FFMPEG_REQUIRED
@pytest.mark.asyncio
async def test_capture_session_encodes_fake_tracks() -> None:
    capture = VideoCaptureSession(
        session_id="s-cap",
        room_name="voice-s-cap",
        livekit_url="ws://unused",
        api_key="k",
        api_secret="s",
    )
    await capture._consume_video(_fake_video_events(8))
    await capture._consume_audio(_fake_audio_events(5))

    webm = await capture.stop()

    assert webm is not None
    streams = await _probe_webm(webm)
    assert "vp8,video" in streams
    assert "opus,audio" in streams


@FFMPEG_REQUIRED
@pytest.mark.asyncio
async def test_capture_session_falls_back_when_no_video_frames() -> None:
    """Audio-only capture (video subscription yielded nothing) -> no WebM."""
    capture = VideoCaptureSession(
        session_id="s-fallback",
        room_name="voice-s-fallback",
        livekit_url="ws://unused",
        api_key="k",
        api_secret="s",
    )
    await capture._consume_audio(_fake_audio_events(3))

    assert await capture.stop() is None


def _make_service(conductor: FakeConductor, mode: str = "video") -> VoiceSessionService:
    return VoiceSessionService(
        session_id="s-persist",
        room_name="voice-s-persist",
        recovery_token="rt",
        stt=MockSttAdapter(fixture="short"),
        tts=MockTtsAdapter(chunk_ms=1),
        conductor=conductor,
        mode=mode,
    )


class _FakeCapture:
    """Stand-in for VideoCaptureSession returning a canned encode result."""

    def __init__(self, webm: bytes | None) -> None:
        self._webm = webm
        self.stopped = False

    async def stop(self) -> bytes | None:
        self.stopped = True
        return self._webm


class _FakeStorage:
    """Records upload_recording calls without touching MinIO."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def upload_recording(
        self,
        session_id: str,
        media_bytes: bytes,
        content_type: str = "audio/wav",
        extension: str = ".wav",
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "session_id": session_id,
                "bytes": media_bytes,
                "content_type": content_type,
                "extension": extension,
            }
        )
        return {"uri": "http://minio/fake", "objectName": f"recordings/{session_id}/abc{extension}"}


class _RecordingConductor(FakeConductor):
    def __init__(self) -> None:
        super().__init__()
        self.recording_calls: list[dict[str, Any]] = []

    async def recording_notification(
        self,
        session_id: str,
        recovery_token: str,
        recording: dict[str, Any],
        media_kind: str | None = None,
    ) -> None:
        self.recording_calls.append({"recording": recording, "media_kind": media_kind})


@pytest.mark.asyncio
async def test_persist_recording_uploads_webm_with_video_media_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _FakeStorage()
    monkeypatch.setattr("app.voice.router.StorageClient", lambda: storage)
    conductor = _RecordingConductor()
    capture = _FakeCapture(b"\x1a\x45\xdf\xa3fake-webm")

    await _persist_recording(
        _make_service(conductor),
        bytearray(b"\x00" * 320),
        capture,  # type: ignore[arg-type]
    )

    assert capture.stopped
    assert storage.calls[0]["content_type"] == "video/webm"
    assert storage.calls[0]["extension"] == ".webm"
    assert conductor.recording_calls[0]["media_kind"] == "video"
    assert conductor.recording_calls[0]["recording"]["objectName"].endswith(".webm")


@pytest.mark.asyncio
async def test_persist_recording_falls_back_to_wav_when_capture_yields_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _FakeStorage()
    monkeypatch.setattr("app.voice.router.StorageClient", lambda: storage)
    conductor = _RecordingConductor()
    capture = _FakeCapture(None)

    await _persist_recording(
        _make_service(conductor),
        bytearray(b"\x00" * 320),
        capture,  # type: ignore[arg-type]
    )

    assert storage.calls[0]["extension"] == ".wav"
    assert conductor.recording_calls[0]["media_kind"] == "audio"


@pytest.mark.asyncio
async def test_persist_recording_audio_only_without_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _FakeStorage()
    monkeypatch.setattr("app.voice.router.StorageClient", lambda: storage)
    conductor = _RecordingConductor()

    await _persist_recording(_make_service(conductor), bytearray(b"\x00" * 320), None)

    assert storage.calls[0]["extension"] == ".wav"
    assert conductor.recording_calls[0]["media_kind"] == "audio"


@pytest.mark.asyncio
async def test_persist_recording_noop_when_nothing_captured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _FakeStorage()
    monkeypatch.setattr("app.voice.router.StorageClient", lambda: storage)
    conductor = _RecordingConductor()

    await _persist_recording(_make_service(conductor), bytearray(), _FakeCapture(None))  # type: ignore[arg-type]

    assert storage.calls == []
    assert conductor.recording_calls == []


@pytest.mark.asyncio
async def test_persist_recording_survives_notification_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FailingConductor(_RecordingConductor):
        async def recording_notification(  # type: ignore[override]
            self,
            session_id: str,
            recovery_token: str,
            recording: dict[str, Any],
            media_kind: str | None = None,
        ) -> None:
            raise RuntimeError("api down")

    storage = _FakeStorage()
    monkeypatch.setattr("app.voice.router.StorageClient", lambda: storage)

    # Must not raise — capture failures never break the interview teardown.
    await _persist_recording(_make_service(_FailingConductor()), bytearray(b"\x00"), None)


@pytest.mark.asyncio
async def test_recorder_token_is_hidden_subscribe_only() -> None:
    import base64
    import json

    capture = VideoCaptureSession(
        session_id="s-tok",
        room_name="voice-s-tok",
        livekit_url="ws://unused",
        api_key="devkey",
        api_secret="secret",
    )
    token = capture._recorder_token()
    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    assert payload["sub"] == "recorder-s-tok"
    video_grants = payload["video"]
    assert video_grants["room"] == "voice-s-tok"
    assert video_grants["roomJoin"] is True
    assert video_grants["hidden"] is True
    assert video_grants.get("canSubscribe", True) is not False
    assert not video_grants.get("canPublish", False)


@pytest.mark.asyncio
async def test_recording_notification_posts_top_level_recording() -> None:
    """The API hook reads body.recording/body.media_kind at the top level."""
    from aiohttp import web

    from app.conductor_client import ConductorClient

    received: list[dict[str, Any]] = []

    async def _handler(request: web.Request) -> web.Response:
        received.append(await request.json())
        assert request.headers["x-recovery-token"] == "rt"
        return web.json_response({"ok": True})

    app = web.Application()
    app.router.add_post("/sessions/s-http/voice/telemetry", _handler)
    runner = web.AppRunner(app)
    await runner.setup()
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    try:
        client = ConductorClient(base_url=f"http://127.0.0.1:{port}")
        await client.recording_notification(
            "s-http",
            "rt",
            {"objectName": "recordings/s-http/abc.webm"},
            media_kind="video",
        )
        await client.close()
    finally:
        await runner.cleanup()

    assert received == [
        {
            "recording": {"objectName": "recordings/s-http/abc.webm"},
            "media_kind": "video",
        }
    ]


@pytest.mark.skipif(
    os.environ.get("RUN_VOICE_E2E") != "1",
    reason="set RUN_VOICE_E2E=1 to run the live LiveKit capture integration test",
)
@pytest.mark.asyncio
async def test_capture_connects_to_live_room() -> None:
    """Live integration: join a room as recorder and disconnect cleanly."""
    capture = VideoCaptureSession(
        session_id="s-e2e",
        room_name=os.environ.get("CAPTURE_E2E_ROOM", "voice-capture-e2e"),
        livekit_url=os.environ.get("LIVEKIT_URL", "ws://localhost:7880"),
        api_key=os.environ.get("LIVEKIT_API_KEY", "devkey"),
        api_secret=os.environ.get("LIVEKIT_API_SECRET", "secret"),
    )
    await capture.start()
    assert await capture.stop() is None  # no publisher -> no media, clean teardown
