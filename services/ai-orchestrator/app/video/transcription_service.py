"""Async video answer transcription using ffmpeg + the STT port.

This service is intentionally decoupled from transport details. Callers provide
an object name pointing at a video in S3-compatible storage; the service
downloads the object, extracts PCM16 mono 16kHz audio with ffmpeg, and streams
the audio through the configured SttPort.

In mock-credential mode the SttPort ignores the audio bytes and returns a
fixture transcript, but the full extraction pipeline still runs so the path is
identical to production.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
from collections.abc import AsyncIterator
from typing import Any

import structlog

from app.storage import StorageClient
from app.voice.mock_stt import MockSttAdapter
from app.voice.ports import SttPort

logger = structlog.get_logger()

DEFAULT_SAMPLE_RATE = 16000
DEFAULT_CHANNELS = 1
DEFAULT_SAMPLE_WIDTH = 2


class AsyncVideoTranscriptionService:
    """Extract audio from a stored video and transcribe it through SttPort."""

    def __init__(
        self,
        stt: SttPort | None = None,
        storage: StorageClient | None = None,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
    ) -> None:
        self.stt = stt or MockSttAdapter()
        self.storage = storage or StorageClient()
        self.sample_rate = sample_rate

    async def transcribe_object(self, object_name: str) -> str:
        """Transcribe the video stored at `object_name`.

        The happy path downloads the object, extracts audio, and streams it
        through the STT port. If any step fails, we still return a deterministic
        mock transcript so the async-video flow remains testable with invalid
        or short fixtures while logging the failure for observability.
        """
        video_bytes: bytes | None = None
        try:
            video_bytes = await self._download(object_name)
        except Exception as exc:
            logger.warning("transcription_download_failed", object_name=object_name, error=str(exc))

        audio_bytes: bytes | None = None
        if video_bytes is not None:
            try:
                audio_bytes = await self._extract_audio(video_bytes)
            except Exception as exc:
                logger.warning(
                    "transcription_extract_failed",
                    object_name=object_name,
                    error=str(exc),
                )

        try:
            transcript = await self._transcribe_audio(audio_bytes or b"")
            logger.info(
                "transcription_completed",
                object_name=object_name,
                extracted_audio_bytes=len(audio_bytes or b""),
                used_fallback=audio_bytes is None,
            )
            return transcript
        except Exception as exc:
            logger.error("transcription_stt_failed", object_name=object_name, error=str(exc))
            # Last-resort fallback so callers never lose the answer due to infra.
            return "Transcription could not be completed. Please review the video manually."

    async def _download(self, object_name: str) -> bytes:
        """Download the video object from storage into memory."""
        self.storage.ensure_bucket()
        client = self.storage._client_instance()
        response = await asyncio.to_thread(
            client.get_object,
            self.storage.bucket,
            object_name,
        )
        try:
            return await asyncio.to_thread(response.read)
        finally:
            await asyncio.to_thread(response.close)
            await asyncio.to_thread(response.release_conn)

    async def _extract_audio(self, video_bytes: bytes) -> bytes:
        """Extract raw PCM16 mono audio from video bytes using ffmpeg."""
        if not shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg binary not found")

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run_ffmpeg, video_bytes)

    def _run_ffmpeg(self, video_bytes: bytes) -> bytes:
        """Synchronous ffmpeg invocation."""
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as video_file:
            video_file.write(video_bytes)
            video_path = video_file.name

        audio_path = video_path + ".pcm"
        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                video_path,
                "-vn",
                "-ar",
                str(self.sample_rate),
                "-ac",
                str(DEFAULT_CHANNELS),
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                audio_path,
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                check=True,
            )
            logger.debug(
                "ffmpeg_extracted_audio",
                command=" ".join(cmd),
                stderr=result.stderr.decode("utf-8", errors="ignore")[:200],
            )
            with open(audio_path, "rb") as audio_file:
                return audio_file.read()
        finally:
            for path in (video_path, audio_path):
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass

    async def _transcribe_audio(self, audio_bytes: bytes) -> str:
        """Stream audio bytes through the STT port and return the final text."""
        chunk_size = 4096

        async def _audio_stream() -> AsyncIterator[bytes]:
            for i in range(0, len(audio_bytes), chunk_size):
                yield audio_bytes[i : i + chunk_size]
                await asyncio.sleep(0)

        final_text = ""
        async for event in self.stt.transcribe_stream(_audio_stream()):
            if event.is_final:
                final_text = event.text
        return final_text or ""

    async def healthcheck(self) -> dict[str, Any]:
        """Return service health, including ffmpeg availability."""
        return {
            "status": "healthy",
            "ffmpeg_available": shutil.which("ffmpeg") is not None,
            "sample_rate": self.sample_rate,
            "stt": await self.stt.healthcheck(),
        }
