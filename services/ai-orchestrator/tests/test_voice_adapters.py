"""Contract tests for STT/TTS mock adapters."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from app.voice.mock_stt import FIXTURES, MockSttAdapter
from app.voice.mock_tts import MockTtsAdapter


async def _empty_audio() -> AsyncIterator[bytes]:
    yield b"\x00" * 320


async def _text_stream(words: list[str]) -> AsyncIterator[str]:
    for word in words:
        yield word + " "


@pytest.mark.asyncio
async def test_mock_stt_emits_final_transcript() -> None:
    adapter = MockSttAdapter(fixture="short")
    events = []
    async for event in adapter.transcribe_stream(_empty_audio()):
        events.append(event)

    assert len(events) >= 1
    assert events[-1].type == "final"
    assert events[-1].text == FIXTURES["short"][-1]
    assert events[-1].is_final is True


@pytest.mark.asyncio
async def test_mock_stt_partials_progress_toward_final() -> None:
    adapter = MockSttAdapter(fixture="hello")
    events = []
    async for event in adapter.transcribe_stream(_empty_audio()):
        events.append(event)

    partials = [e for e in events if e.type == "partial"]
    assert len(partials) > 0
    finals = [e for e in events if e.type == "final"]
    assert len(finals) == 1
    # The final transcript should subsume the last partial.
    assert finals[0].text.startswith(partials[-1].text) or finals[0].text == partials[-1].text


@pytest.mark.asyncio
async def test_mock_stt_hinglish_fixture_exists() -> None:
    adapter = MockSttAdapter(fixture="hinglish")
    events = [e async for e in adapter.transcribe_stream(_empty_audio())]
    assert events[-1].type == "final"
    assert "kiya" in events[-1].text.lower()


@pytest.mark.asyncio
async def test_mock_tts_emits_chunks_for_text() -> None:
    adapter = MockTtsAdapter(chunk_ms=10)
    chunks = []
    async for chunk in adapter.synthesize_stream(
        _text_stream(["Hello", "world."]),
    ):
        chunks.append(chunk)

    assert len(chunks) >= 1
    assert all(len(c.audio_bytes) > 0 for c in chunks)
    full_text = " ".join(c.text for c in chunks).strip()
    assert "Hello" in full_text
    assert "world" in full_text


@pytest.mark.asyncio
async def test_mock_tts_failure_raises_on_configured_text() -> None:
    adapter = MockTtsAdapter(chunk_ms=1, fail_after_text="boom")
    with pytest.raises(RuntimeError, match="mock tts failure"):
        async for _chunk in adapter.synthesize_stream(_text_stream(["first", "boom", "third"])):
            pass


@pytest.mark.asyncio
async def test_mock_stt_failure_raises_after_byte_threshold() -> None:
    adapter = MockSttAdapter(fail_after_bytes=10)

    async def _big_audio() -> AsyncIterator[bytes]:
        while True:
            yield b"\x00" * 64
            await asyncio.sleep(0)

    with pytest.raises(RuntimeError, match="mock stt failure"):
        async for _event in adapter.transcribe_stream(_big_audio()):
            pass
