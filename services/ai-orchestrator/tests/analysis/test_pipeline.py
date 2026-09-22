"""Integration tests for POST /analysis/video.

Gated on ffmpeg + a reachable MinIO (same pattern as test_video_transcription).
MediaPipe / VAD models are NOT required: missing models degrade feature groups
instead of failing the job, and the assertions tolerate both regimes.
"""

from __future__ import annotations

import shutil
import socket
import subprocess
import tempfile
from collections.abc import AsyncIterator
from io import BytesIO
from pathlib import Path

import httpx
import pytest

import app.analysis.router as analysis_router
from app.analysis.config import load_settings
from app.analysis.schemas import AnalysisResponse
from app.analysis.service import AnalysisService
from app.main import app
from app.storage import StorageClient
from app.voice.mock_stt import MockSttAdapter
from app.voice.ports import SttPort


def _minio_endpoint() -> str | None:
    for host in ("localhost", "minio"):
        try:
            with socket.create_connection((host, 9000), timeout=1):
                return f"{host}:9000"
        except OSError:
            continue
    return None


def _require_infra() -> str:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg/ffprobe not installed")
    endpoint = _minio_endpoint()
    if endpoint is None:
        pytest.skip("MinIO not reachable on localhost:9000 or minio:9000")
    return endpoint


def _generate_webm_bytes() -> bytes:
    """Generate a tiny valid WebM with ffmpeg and return its bytes."""
    with tempfile.TemporaryDirectory() as tmp:
        video_path = str(Path(tmp) / "in.webm")
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=duration=2:size=320x240:rate=5",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
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
        return Path(video_path).read_bytes()


class _FailingStt(SttPort):
    async def transcribe_stream(
        self,
        audio_stream: AsyncIterator[bytes],
        language_hint: str | None = None,
    ) -> AsyncIterator:
        raise RuntimeError("stt backend exploded")
        yield  # type: ignore[unreachable]  # makes this a proper async generator

    async def healthcheck(self) -> dict[str, object]:
        return {"status": "unhealthy"}


def _payload(object_name: str, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "analysis_job_id": "job-test-1",
        "session_id": "session-test-1",
        "question_id": "question-1",
        "object_name": object_name,
        "media_kind": "video",
        "include_transcript": True,
        "language_hint": "en-US",
        "consent_verified": True,
    }
    body.update(overrides)
    return body


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> StorageClient:
    _require_infra()
    client: StorageClient | None = None
    for host in ("localhost", "minio"):
        for password in ("minioadmin", "minioadmin_dev"):
            monkeypatch.setenv("MINIO_ENDPOINT", f"{host}:9000")
            monkeypatch.setenv("MINIO_ROOT_USER", "minioadmin")
            monkeypatch.setenv("MINIO_ROOT_PASSWORD", password)
            candidate = StorageClient()
            try:
                candidate.ensure_bucket()
                client = candidate
                break
            except Exception:
                continue
        if client is not None:
            break
    if client is None:
        pytest.skip("no reachable MinIO with known dev credentials")
    return client


def _service_for(monkeypatch: pytest.MonkeyPatch, storage: StorageClient, stt: SttPort) -> None:
    service = AnalysisService(
        settings=load_settings({"STT_ADAPTER": "mock"}),
        storage=storage,
        stt=stt,
    )
    monkeypatch.setattr(analysis_router, "get_service", lambda: service)


async def _post(payload: dict[str, object]) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120.0
    ) as client:
        return await client.post("/analysis/video", json=payload)


@pytest.mark.asyncio
async def test_analysis_video_happy_path(
    monkeypatch: pytest.MonkeyPatch, storage: StorageClient
) -> None:
    object_name = "test/analysis/happy.webm"
    data = _generate_webm_bytes()
    storage._client_instance().put_object(
        storage.bucket,
        object_name,
        data=BytesIO(data),
        length=len(data),
        content_type="video/webm",
    )
    _service_for(monkeypatch, storage, MockSttAdapter(fixture="short"))
    try:
        response = await _post(_payload(object_name))
        assert response.status_code == 200, response.text
        parsed = AnalysisResponse.model_validate(response.json())
        assert parsed.status == "completed"
        assert parsed.schema_version == "1.0.0"
        assert parsed.analysis_job_id == "job-test-1"
        assert parsed.transcript_text == "Yes, I have five years of experience."
        assert parsed.media.duration_sec > 0
        assert parsed.metrics.frames_processed > 0
        # Objective-only invariants: interaction always invalid for
        # single-speaker media; no group reports fabricated zeros.
        for field_name in type(parsed.features.interaction).model_fields:
            measurement = getattr(parsed.features.interaction, field_name)
            assert measurement.valid is False
            assert measurement.reason == "single_speaker_recording"
        # Artifacts persisted under the documented prefix.
        prefix = "analysis/session-test-1/question-1"
        assert parsed.result.object_prefix == prefix
        assert "aggregated_features" in parsed.result.objects
        assert "transcript" in parsed.result.objects
        client = storage._client_instance()
        for name in parsed.result.objects.values():
            client.stat_object(storage.bucket, name)
            client.remove_object(storage.bucket, name)
    finally:
        storage._client_instance().remove_object(storage.bucket, object_name)


@pytest.mark.asyncio
async def test_analysis_video_missing_object_404(
    monkeypatch: pytest.MonkeyPatch, storage: StorageClient
) -> None:
    _service_for(monkeypatch, storage, MockSttAdapter(fixture="short"))
    response = await _post(_payload("test/analysis/does-not-exist.webm"))
    assert response.status_code == 404
    assert response.json()["error_code"] == "OBJECT_NOT_FOUND"


@pytest.mark.asyncio
async def test_analysis_video_corrupt_media_422(
    monkeypatch: pytest.MonkeyPatch, storage: StorageClient
) -> None:
    object_name = "test/analysis/corrupt.webm"
    data = b"this is not a video file at all"
    storage._client_instance().put_object(
        storage.bucket,
        object_name,
        data=BytesIO(data),
        length=len(data),
        content_type="video/webm",
    )
    _service_for(monkeypatch, storage, MockSttAdapter(fixture="short"))
    try:
        response = await _post(_payload(object_name))
        assert response.status_code == 422
        assert response.json()["error_code"] == "CORRUPT_MEDIA"
    finally:
        storage._client_instance().remove_object(storage.bucket, object_name)


@pytest.mark.asyncio
async def test_analysis_video_stt_failure_502(
    monkeypatch: pytest.MonkeyPatch, storage: StorageClient
) -> None:
    object_name = "test/analysis/stt-fail.webm"
    data = _generate_webm_bytes()
    storage._client_instance().put_object(
        storage.bucket,
        object_name,
        data=BytesIO(data),
        length=len(data),
        content_type="video/webm",
    )
    _service_for(monkeypatch, storage, _FailingStt())
    try:
        response = await _post(_payload(object_name))
        assert response.status_code == 502
        assert response.json()["error_code"] == "STT_FAILED"
    finally:
        storage._client_instance().remove_object(storage.bucket, object_name)


@pytest.mark.asyncio
async def test_analysis_video_rejects_unverified_consent(
    monkeypatch: pytest.MonkeyPatch, storage: StorageClient
) -> None:
    _service_for(monkeypatch, storage, MockSttAdapter(fixture="short"))
    response = await _post(_payload("anything.webm", consent_verified=False))
    assert response.status_code == 400
    assert response.json()["error_code"] == "INVALID_REQUEST"


@pytest.mark.asyncio
async def test_analysis_video_rejects_bad_payload(
    monkeypatch: pytest.MonkeyPatch, storage: StorageClient
) -> None:
    _service_for(monkeypatch, storage, MockSttAdapter(fixture="short"))
    response = await _post({"object_name": 123})
    assert response.status_code == 400
    assert response.json()["error_code"] == "INVALID_REQUEST"


@pytest.mark.asyncio
async def test_analysis_health_endpoint() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/analysis/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["stt_adapter"] in ("mock", "gcp")
    assert isinstance(body["ffmpeg_available"], bool)
    assert set(body["models"]) >= {
        "face_landmarker",
        "pose_landmarker",
        "hand_landmarker",
        "silero_vad",
    }
