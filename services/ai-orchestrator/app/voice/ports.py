"""Provider ports for speech adapters (STT, TTS).

Real third-party adapters implement these same interfaces in later phases.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from app.voice.models import SttEvent, TtsChunk


class SttPort(ABC):
    """Streaming speech-to-text port.

    Adapters accept an audio byte iterator and yield partial/final transcript
    events. In mock mode the audio is ignored and a scripted transcript is
    streamed with realistic timing.
    """

    @abstractmethod
    def transcribe_stream(
        self,
        audio_stream: AsyncIterator[bytes],
        language_hint: str | None = None,
    ) -> AsyncIterator[SttEvent]:
        """Yield SttEvent partials and a single final event."""
        raise NotImplementedError

    @abstractmethod
    async def healthcheck(self) -> dict[str, object]:
        """Return adapter health and configuration metadata."""
        raise NotImplementedError


class TtsPort(ABC):
    """Streaming text-to-speech port.

    Adapters accept text fragments and yield audio chunks. In mock mode the
    audio is synthetic silence chunked sentence-by-sentence.
    """

    @abstractmethod
    def synthesize_stream(
        self,
        text_stream: AsyncIterator[str],
        language_hint: str | None = None,
        voice_id: str | None = None,
    ) -> AsyncIterator[TtsChunk]:
        """Yield TtsChunk audio chunks as text arrives."""
        raise NotImplementedError

    @abstractmethod
    async def healthcheck(self) -> dict[str, object]:
        """Return adapter health and configuration metadata."""
        raise NotImplementedError
