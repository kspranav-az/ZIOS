"""FastAPI routes for async video answer transcription."""

from __future__ import annotations

from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Form

from app.video.transcription_service import AsyncVideoTranscriptionService

router = APIRouter(prefix="/video", tags=["video"])
logger = structlog.get_logger()


@router.post("/transcribe")
async def transcribe_video(
    object_name: Annotated[str, Form(...)],
) -> dict[str, str]:
    """Transcribe a video stored in S3-compatible storage.

    The orchestrator downloads the object, extracts PCM16 audio with ffmpeg,
    and routes the audio through the configured SttPort (mock by default).
    """
    logger.info("transcribe_video_request", object_name=object_name)
    service = AsyncVideoTranscriptionService()
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
    service = AsyncVideoTranscriptionService()
    return await service.healthcheck()
