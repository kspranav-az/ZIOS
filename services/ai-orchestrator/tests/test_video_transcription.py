"""Tests for async video transcription service (ffmpeg + STT port)."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from collections.abc import AsyncIterator
from io import BytesIO

import pytest

from app.storage import StorageClient
from app.video.transcription_service import AsyncVideoTranscriptionService
from app.voice.mock_stt import MockSttAdapter
from app.voice.ports import SttPort


class _FailingStt(SttPort):
    """STT adapter that always raises, to exercise fallback behavior."""

    async def transcribe_stream(
        self,
        audio_stream: AsyncIterator[bytes],
        language_hint: str | None = None,
    ) -> AsyncIterator:
        raise RuntimeError("stt unavailable")
        yield  # type: ignore[unreachable]  # makes this a proper async generator

    async def healthcheck(self) -> dict[str, object]:
        return {"status": "unhealthy"}


@pytest.mark.asyncio
async def test_service_returns_mock_transcript_for_empty_bytes() -> None:
    """Even without valid video bytes, the service returns a usable transcript."""
    service = AsyncVideoTranscriptionService(stt=MockSttAdapter(fixture="short"))
    transcript = await service.transcribe_object("nonexistent-object.webm")
    assert len(transcript) > 0


@pytest.mark.asyncio
async def test_service_returns_fallback_when_stt_fails() -> None:
    service = AsyncVideoTranscriptionService(stt=_FailingStt())
    transcript = await service.transcribe_object("nonexistent-object.webm")
    assert "could not be completed" in transcript.lower()


def _generate_test_webm(video_path: str) -> None:
    """Synchronous helper: generate a tiny valid WebM with ffmpeg."""
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=320x240:rate=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=1",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libvpx-vp9",
            "-c:a",
            "libopus",
            video_path,
        ],
        capture_output=True,
        check=True,
    )


def _read_file_bytes(path: str) -> bytes:
    """Synchronous helper: read file contents."""
    with open(path, "rb") as f:
        return f.read()


def _reachable_storage() -> StorageClient | None:
    """StorageClient bound to a reachable MinIO, or None when offline.

    Tries the compose-network hostname and localhost with the default dev
    credentials so the integration test works both inside and outside Docker.
    """
    import socket

    for host in ("minio", "localhost"):
        try:
            with socket.create_connection((host, 9000), timeout=1):
                pass
        except OSError:
            continue
        for password in ("minioadmin", "minioadmin_dev"):
            os.environ["MINIO_ENDPOINT"] = f"{host}:9000"
            os.environ["MINIO_ROOT_PASSWORD"] = password
            candidate = StorageClient()
            try:
                candidate.ensure_bucket()
                return candidate
            except Exception:
                continue
    return None


@pytest.mark.asyncio
async def test_service_uses_ffmpeg_pipeline_with_real_video() -> None:
    """Generate a tiny valid WebM with ffmpeg, upload it to MinIO, and transcribe."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")

    storage = _reachable_storage()
    if storage is None:
        pytest.skip("MinIO not reachable with dev credentials")

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as video_file:
        video_path = video_file.name

    audio_path = video_path + ".wav"
    try:
        _generate_test_webm(video_path)
    except (subprocess.CalledProcessError, FileNotFoundError):
        pytest.skip("could not generate test webm")

    storage.ensure_bucket()
    object_name = "test/async-video-transcription/test.webm"
    try:
        video_bytes = _read_file_bytes(video_path)
        storage._client_instance().put_object(
            storage.bucket,
            object_name,
            data=BytesIO(video_bytes),
            length=len(video_bytes),
            content_type="video/webm",
        )

        service = AsyncVideoTranscriptionService(stt=MockSttAdapter(fixture="short"))
        transcript = await service.transcribe_object(object_name)
        assert transcript == "Yes, I have five years of experience."
    finally:
        storage._client_instance().remove_object(storage.bucket, object_name)
        for path in (video_path, audio_path):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass


@pytest.mark.asyncio
async def test_healthcheck_reports_ffmpeg_availability() -> None:
    service = AsyncVideoTranscriptionService()
    health = await service.healthcheck()
    assert health["status"] == "healthy"
    assert isinstance(health["ffmpeg_available"], bool)
    assert health["sample_rate"] == 16000
