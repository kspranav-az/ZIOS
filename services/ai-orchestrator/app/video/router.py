"""FastAPI routes for async video answer transcription."""

from __future__ import annotations

from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Form

from app.analysis.config import load_settings
from app.analysis.stt.factory import build_stt_adapter
from app.video.transcription_service import AsyncVideoTranscriptionService

router = APIRouter(prefix="/video", tags=["video"])
logger = structlog.get_logger()

# Adapter is process-wide and selected at boot (same pattern as the voice
# router): a bad STT_ADAPTER value fails loudly before any request, and
# STT_ADAPTER=mock keeps CI/e2e hermetic. Bare AsyncVideoTranscriptionService()
# would silently default to MockSttAdapter and ignore STT_ADAPTER — the
# /video/transcribe path must never do that.
_stt_adapter = build_stt_adapter(load_settings())


@router.post("/transcribe")
async def transcribe_video(
    object_name: Annotated[str, Form(...)],
) -> dict[str, str]:
    """Transcribe a video stored in S3-compatible storage.

    The orchestrator downloads the object, extracts PCM16 audio with ffmpeg,
    and routes the audio through the configured SttPort (STT_ADAPTER env:
    mock | gcp).
    """
    logger.info("transcribe_video_request", object_name=object_name)
    service = AsyncVideoTranscriptionService(stt=_stt_adapter)
    transcript = await service.transcribe_object(object_name)
    logger.info(
        "transcribe_video_completed",
        object_name=object_name,
        transcript_length=len(transcript),
    )
    return {"transcript": transcript}


@router.get("/health/transcription")
async def transcription_healthcheck() -> dict[str, Any]:
    """Health check for the async video transcription pipeline."""
    service = AsyncVideoTranscriptionService(stt=_stt_adapter)
    return await service.healthcheck()
