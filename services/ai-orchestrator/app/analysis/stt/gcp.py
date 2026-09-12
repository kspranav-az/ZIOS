"""Google Cloud Speech-to-Text v2 adapter behind ``SttPort``.

Buffers the incoming PCM16 mono 16 kHz stream and issues a single v2
``Recognize`` call with inline content (inline content is limited to ~10 MB,
i.e. roughly 5 minutes of PCM16 16 kHz mono — sufficient for one interview
answer; longer media must be chunked before this adapter is used for it).

Credentials come ONLY from the environment (GOOGLE_APPLICATION_CREDENTIALS /
ADC). Construction fails loudly when the project id is missing; the underlying
client raises if no credentials are available — no silent fallbacks.

The extra ``transcribe_with_timestamps`` method (NOT part of ``SttPort``)
returns a ``NormalizedTranscript`` with word-level timing for the analysis
pipeline.
"""

from __future__ import annotations

import asyncio
import datetime
from collections.abc import AsyncIterator
from typing import Any

import structlog

from app.analysis.errors import SttError
from app.analysis.transcript_schema import (
    NormalizedTranscript,
    TranscriptSegment,
    WordTiming,
)
from app.voice.models import SttEvent
from app.voice.ports import SttPort

logger = structlog.get_logger()

DEFAULT_LANGUAGE_CODES = ("en-US",)
# v2 inline-content Recognize is limited to 10 MB of audio.
MAX_INLINE_BYTES = 10 * 1024 * 1024


class GoogleCloudSttAdapter(SttPort):
    def __init__(
        self,
        project_id: str | None,
        location: str = "global",
        config: dict[str, object] | None = None,
        client: Any | None = None,
    ) -> None:
        if not project_id:
            raise SttError("GCP_PROJECT_ID is required when STT_ADAPTER=gcp")
        self._project_id = project_id
        self._location = location
        self._config = config or {}
        if client is not None:
            self._client = client
        else:
            # Imported here so importing this module never requires the SDK.
            from google.cloud.speech_v2 import SpeechClient

            # google.auth.default() runs at construction and raises when no
            # credentials are configured — this is the intended loud failure.
            self._client = SpeechClient()

    async def transcribe_stream(
        self,
        audio_stream: AsyncIterator[bytes],
        language_hint: str | None = None,
    ) -> AsyncIterator[SttEvent]:
        chunks: list[bytes] = []
        async for chunk in audio_stream:
            chunks.append(chunk)
        pcm = b"".join(chunks)
        transcript = await self.transcribe_with_timestamps(
            pcm, sample_rate=16000, language_hint=language_hint
        )
        text = transcript.full_text()
        confidence = next(
            (seg.confidence for seg in transcript.segments if seg.confidence is not None),
            None,
        )
        yield SttEvent(
            type="final",
            text=text,
            is_final=True,
            confidence=confidence if confidence is not None else 1.0,
            language=language_hint,
        )

    async def transcribe_with_timestamps(
        self,
        pcm_bytes: bytes,
        sample_rate: int,
        language_hint: str | None = None,
    ) -> NormalizedTranscript:
        """Recognize buffered PCM16 mono audio and normalize word timings."""
        if len(pcm_bytes) > MAX_INLINE_BYTES:
            raise SttError(f"audio of {len(pcm_bytes)} bytes exceeds the v2 inline-content limit")
        try:
            response = await asyncio.to_thread(self._recognize, pcm_bytes, language_hint)
        except SttError:
            raise
        except Exception as exc:
            raise SttError(f"gcp speech recognize failed: {exc}") from exc
        return self._normalize(response)

    def _recognize(self, pcm_bytes: bytes, language_hint: str | None) -> Any:
        from google.cloud.speech_v2 import (
            AutoDetectDecodingConfig,
            RecognitionConfig,
            RecognitionFeatures,
            RecognizeRequest,
        )

        language_codes = self._config.get("language_codes")
        if not isinstance(language_codes, list) or not language_codes:
            language_codes = [language_hint] if language_hint else list(DEFAULT_LANGUAGE_CODES)

        config = RecognitionConfig(
            auto_decoding_config=AutoDetectDecodingConfig(),
            language_codes=language_codes,
            features=RecognitionFeatures(enable_word_time_offsets=True),
        )
        model = self._config.get("model")
        if isinstance(model, str) and model:
            config.model = model

        recognizer = f"projects/{self._project_id}/locations/{self._location}/recognizers/_"
        request = RecognizeRequest(config=config, content=pcm_bytes, recognizer=recognizer)
        return self._client.recognize(request=request)

    def _normalize(self, response: Any) -> NormalizedTranscript:
        segments: list[TranscriptSegment] = []
        for result in response.results:
            alternative = result.alternatives[0] if result.alternatives else None
            if alternative is None:
                continue
            words = [
                WordTiming(
                    text=w.word,
                    start=_duration_to_sec(w.start_offset),
                    end=_duration_to_sec(w.end_offset),
                    confidence=getattr(w, "confidence", None) or None,
                )
                for w in alternative.words
            ]
            if words:
                start = words[0].start
                end = words[-1].end
            else:
                start = _duration_to_sec(getattr(result, "result_end_offset", None))
                end = start
            segments.append(
                TranscriptSegment(
                    speaker="candidate",
                    start=start,
                    end=end,
                    text=alternative.transcript,
                    confidence=alternative.confidence or None,
                    words=words,
                )
            )
        return NormalizedTranscript(segments=segments)

    async def healthcheck(self) -> dict[str, object]:
        return {
            "status": "healthy",
            "provider": "gcp",
            "project_id": self._project_id,
            "location": self._location,
        }


def _duration_to_sec(duration: Any) -> float:
    if duration is None:
        return 0.0
    # proto-plus exposes protobuf Duration fields as datetime.timedelta.
    if isinstance(duration, datetime.timedelta):
        return duration.total_seconds()
    return float(getattr(duration, "seconds", 0)) + float(getattr(duration, "nanos", 0)) / 1e9
