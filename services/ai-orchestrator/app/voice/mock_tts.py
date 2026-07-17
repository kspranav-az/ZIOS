"""Mock TTS adapter for local development and contract testing.

The adapter accepts text fragments, splits them into sentences, and yields
synthetic audio chunks with realistic timing. Audio bytes are a deterministic
PCM-like placeholder (zeros) so checksums are stable for tests.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator

from app.voice.models import TtsChunk
from app.voice.ports import TtsPort

SENTENCE_RE = re.compile(r"[^.!?]+[.!?]*")
DEFAULT_CHUNK_MS = 80
DEFAULT_SAMPLE_RATE = 24000
DEFAULT_CHANNELS = 1
DEFAULT_SAMPLE_WIDTH = 2
# Bytes per second of PCM16 mono audio.
BYTES_PER_SECOND = DEFAULT_SAMPLE_RATE * DEFAULT_CHANNELS * DEFAULT_SAMPLE_WIDTH


class MockTtsAdapter(TtsPort):
    """Sentence-chunked synthetic TTS with configurable latency."""

    def __init__(
        self,
        chunk_ms: int = DEFAULT_CHUNK_MS,
        fail_after_text: str | None = None,
    ) -> None:
        self.chunk_ms = chunk_ms
        self.fail_after_text = fail_after_text
        self._chunks_seen = 0
        self._healthy = True
        self._text_seen = ""

    def _synthetic_chunk(self, text: str, duration_ms: int) -> bytes:
        """Return deterministic silence bytes proportional to text length."""
        bytes_count = max(1, (duration_ms * BYTES_PER_SECOND) // 1000)
        return b"\x00" * bytes_count

    async def synthesize_stream(
        self,
        text_stream: AsyncIterator[str],
        language_hint: str | None = None,
        voice_id: str | None = None,
    ) -> AsyncIterator[TtsChunk]:
        buffered = ""
        async for text in text_stream:
            self._text_seen += text
            if self.fail_after_text and self.fail_after_text in self._text_seen:
                self._healthy = False
                raise RuntimeError("mock tts failure")
            buffered += text
            while True:
                match = SENTENCE_RE.match(buffered)
                if not match:
                    break
                sentence = match.group(0).strip()
                buffered = buffered[match.end() :]
                if not sentence:
                    continue
                duration_ms = max(200, len(sentence) * 80)
                await asyncio.sleep(self.chunk_ms / 1000)
                self._chunks_seen += 1
                yield TtsChunk(
                    audio_bytes=self._synthetic_chunk(sentence, duration_ms),
                    text=sentence,
                    is_final=False,
                )
        # Flush any remaining fragment as final.
        if buffered.strip():
            duration_ms = max(200, len(buffered.strip()) * 80)
            await asyncio.sleep(self.chunk_ms / 1000)
            self._chunks_seen += 1
            yield TtsChunk(
                audio_bytes=self._synthetic_chunk(buffered.strip(), duration_ms),
                text=buffered.strip(),
                is_final=True,
            )

    async def healthcheck(self) -> dict[str, object]:
        return {
            "status": "healthy" if self._healthy else "unhealthy",
            "provider": "mock",
            "chunks_seen": self._chunks_seen,
        }
