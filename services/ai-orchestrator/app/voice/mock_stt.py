"""Mock STT adapter for local development and contract testing.

The adapter ignores incoming audio and emits a scripted sequence of partial
and final transcripts. It supports barge-in simulation and Hinglish
(code-switch) samples for fixture-driven tests.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from app.voice.models import SttEvent
from app.voice.ports import SttPort

# Fixture transcripts used in development and contract tests.
FIXTURES: dict[str, list[str]] = {
    "hello": [
        "I",
        "I think",
        "I think the",
        "I think the most challenging",
        "I think the most challenging part was",
        "I think the most challenging part was aligning",
        "I think the most challenging part was aligning the team.",
    ],
    "hinglish": [
        "Haan",
        "Haan main",
        "Haan main yeh",
        "Haan main yeh project",
        "Haan main yeh project handle",
        "Haan main yeh project handle kiya tha",
        "Haan main yeh project handle kiya tha and we delivered on time.",
    ],
    "short": ["Yes, I have five years of experience."],
}

DEFAULT_PARTIAL_DELAY_SECONDS = 0.08
DEFAULT_FINAL_DELAY_SECONDS = 0.15


class MockSttAdapter(SttPort):
    """Fixture-driven mock STT with configurable latency."""

    def __init__(
        self,
        fixture: str = "hello",
        partial_delay: float = DEFAULT_PARTIAL_DELAY_SECONDS,
        final_delay: float = DEFAULT_FINAL_DELAY_SECONDS,
        fail_after_bytes: int | None = None,
    ) -> None:
        self.fixture = fixture
        self.partial_delay = partial_delay
        self.final_delay = final_delay
        self.fail_after_bytes = fail_after_bytes
        self._bytes_seen = 0
        self._healthy = True

    async def transcribe_stream(
        self,
        audio_stream: AsyncIterator[bytes],
        language_hint: str | None = None,
    ) -> AsyncIterator[SttEvent]:
        transcript = FIXTURES.get(self.fixture, FIXTURES["hello"])
        consumed = 0

        # Consume audio concurrently so the caller can keep sending.
        async def _drain() -> None:
            nonlocal consumed
            async for _chunk in audio_stream:
                consumed += len(_chunk)
                self._bytes_seen += len(_chunk)
                if self.fail_after_bytes and self._bytes_seen >= self.fail_after_bytes:
                    self._healthy = False
                    raise RuntimeError("mock stt failure")

        drain_task = asyncio.create_task(_drain())
        try:
            for _i, text in enumerate(transcript):
                await asyncio.sleep(self.partial_delay)
                yield SttEvent(
                    type="partial",
                    text=text,
                    is_final=False,
                    confidence=0.92,
                    language=language_hint,
                )
            await asyncio.sleep(self.final_delay)
            yield SttEvent(
                type="final",
                text=transcript[-1],
                is_final=True,
                confidence=0.94,
                language=language_hint,
            )
        finally:
            drain_task.cancel()
            try:
                await drain_task
            except asyncio.CancelledError:
                pass

    async def healthcheck(self) -> dict[str, object]:
        return {
            "status": "healthy" if self._healthy else "unhealthy",
            "provider": "mock",
            "fixture": self.fixture,
            "bytes_seen": self._bytes_seen,
        }
