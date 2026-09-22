"""Google Cloud Speech-to-Text v2 adapter behind ``SttPort``.

Buffers the incoming PCM16 mono audio and issues v2 ``Recognize`` calls with
inline content. Two real-API limits drive the shape of this adapter
(validated against the live API 2026-09-22):

- Synchronous ``Recognize`` accepts at most **60 seconds** of audio per
  request (the 10 MB inline-content ceiling is rarely reached first), so
  longer input is chunked into sequential per-minute ``Recognize`` calls.
- Raw PCM16 cannot use ``AutoDetectDecodingConfig`` — the decoding params
  must be declared explicitly.

Credentials come ONLY from the environment (GOOGLE_APPLICATION_CREDENTIALS /
ADC). Construction fails loudly when the project id is missing; the underlying
client raises if no credentials are available — no silent fallbacks.

The extra ``transcribe_with_timestamps`` method (NOT part of ``SttPort``)
returns a ``NormalizedTranscript`` with word-level timing for the analysis
pipeline. Chunked calls have their word offsets shifted so timings stay
relative to the start of the full input.
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
# v2 synchronous Recognize rejects audio longer than 60 s per request.
MAX_SYNC_AUDIO_SEC = 60.0
# Default v2 model: long-form audio; required non-empty by the global location.
DEFAULT_MODEL = "latest_long"


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
        """Recognize buffered PCM16 mono audio and normalize word timings.

        Input longer than 60 s is split into sequential per-minute
        ``Recognize`` calls (the v2 sync limit); word/segment timings from
        later chunks are shifted by the cumulative chunk duration so the
        returned transcript stays relative to the start of the full input.
        """
        bytes_per_sec = sample_rate * 2  # PCM16 mono = 2 bytes per sample
        chunk_len = int(MAX_SYNC_AUDIO_SEC * bytes_per_sec)
        chunks = [pcm_bytes[i : i + chunk_len] for i in range(0, len(pcm_bytes), chunk_len)]
        segments: list[TranscriptSegment] = []
        time_offset = 0.0
        try:
            for chunk in chunks:
                if not chunk:
                    continue
                response = await asyncio.to_thread(
                    self._recognize, chunk, sample_rate, language_hint
                )
                segments.extend(self._normalize(response, time_offset))
                time_offset += len(chunk) / bytes_per_sec
        except SttError:
            raise
        except Exception as exc:
            raise SttError(f"gcp speech recognize failed: {exc}") from exc
        return NormalizedTranscript(segments=segments)

    def _recognize(self, pcm_bytes: bytes, sample_rate: int, language_hint: str | None) -> Any:
        from google.cloud.speech_v2 import (
            ExplicitDecodingConfig,
            RecognitionConfig,
            RecognitionFeatures,
            RecognizeRequest,
        )

        language_codes = self._config.get("language_codes")
        if not isinstance(language_codes, list) or not language_codes:
            language_codes = [language_hint] if language_hint else list(DEFAULT_LANGUAGE_CODES)

        config = RecognitionConfig(
            # The SttPort contract is raw PCM16 mono, which v2 auto-detect
            # cannot identify (validated against the real API 2026-09-22) —
            # the decoding params must be declared explicitly.
            explicit_decoding_config=ExplicitDecodingConfig(
                encoding=ExplicitDecodingConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=sample_rate,
                audio_channel_count=1,
            ),
            language_codes=language_codes,
            features=RecognitionFeatures(enable_word_time_offsets=True),
        )
        # The v2 global location rejects a request without a model
        # ("field must be non-empty"); default to long-form, the only
        # sensible default for interview answers.
        model = self._config.get("model")
        if not isinstance(model, str) or not model:
            model = DEFAULT_MODEL
        config.model = model

        recognizer = f"projects/{self._project_id}/locations/{self._location}/recognizers/_"
        request = RecognizeRequest(config=config, content=pcm_bytes, recognizer=recognizer)
        return self._client.recognize(request=request)

    def _normalize(self, response: Any, time_offset: float = 0.0) -> list[TranscriptSegment]:
        segments: list[TranscriptSegment] = []
        for result in response.results:
            alternative = result.alternatives[0] if result.alternatives else None
            if alternative is None:
                continue
            words = [
                WordTiming(
                    text=w.word,
                    start=_duration_to_sec(w.start_offset) + time_offset,
                    end=_duration_to_sec(w.end_offset) + time_offset,
                    confidence=getattr(w, "confidence", None) or None,
                )
                for w in alternative.words
            ]
            if words:
                start = words[0].start
                end = words[-1].end
            else:
                start = _duration_to_sec(getattr(result, "result_end_offset", None)) + time_offset
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
        return segments

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
