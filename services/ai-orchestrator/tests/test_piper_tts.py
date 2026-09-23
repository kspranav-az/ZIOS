"""Contract tests for the Piper TTS adapter and the TTS_ADAPTER factory.

Skipped automatically when the voice model is not downloaded (CI/hermetic
runs) — the mock adapter remains the tested default there.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import numpy as np
import pytest

from app.voice.mock_tts import MockTtsAdapter
from app.voice.piper_tts import WIRE_SAMPLE_RATE, PiperTtsAdapter, default_model_path
from app.voice.tts_factory import build_tts_adapter

pytest.importorskip("piper")

pytestmark = pytest.mark.skipif(
    not default_model_path().exists(),
    reason="piper voice model not downloaded (see phases/phase-12f-piper-local-tts.md)",
)


async def _text_stream(words: list[str]) -> AsyncIterator[str]:
    for word in words:
        yield word + " "


@pytest.mark.asyncio
async def test_piper_tts_contract_chunks_and_text() -> None:
    adapter = PiperTtsAdapter()
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["Hello", "world."]))]
    assert len(chunks) >= 1
    assert all(len(c.audio_bytes) > 0 and len(c.audio_bytes) % 2 == 0 for c in chunks)
    full_text = " ".join(c.text for c in chunks).strip()
    assert "Hello" in full_text
    assert "world" in full_text


@pytest.mark.asyncio
async def test_piper_tts_outputs_pcm16_mono_non_silence() -> None:
    adapter = PiperTtsAdapter()
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["Testing", "one", "two."]))]
    pcm = np.frombuffer(b"".join(c.audio_bytes for c in chunks), dtype=np.int16)
    assert len(chunks) >= 1
    # A real sentence at 24 kHz cannot be shorter than ~0.16 s.
    assert len(pcm) >= 4000
    assert int(np.abs(pcm).max()) > 100


@pytest.mark.asyncio
async def test_piper_tts_synthesizes_punctuationless_text() -> None:
    """No terminal punctuation: the whole fragment is still spoken (the
    sentence regex consumes the tail), matching MockTtsAdapter semantics."""
    adapter = PiperTtsAdapter()
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["tell me more"]))]
    assert len(chunks) == 1
    assert chunks[0].text == "tell me more"
    assert len(chunks[0].audio_bytes) > 0


@pytest.mark.asyncio
async def test_piper_tts_healthcheck() -> None:
    adapter = PiperTtsAdapter()
    health = await adapter.healthcheck()
    assert health["status"] == "healthy"
    assert health["provider"] == "piper"
    assert health["sample_rate"] == WIRE_SAMPLE_RATE
    assert health["source_sample_rate"] == 22050


def test_tts_factory_defaults_to_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TTS_ADAPTER", raising=False)
    assert isinstance(build_tts_adapter(), MockTtsAdapter)


def test_tts_factory_rejects_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_ADAPTER", "bogus")
    with pytest.raises(ValueError, match="unknown TTS_ADAPTER"):
        build_tts_adapter()


def test_tts_factory_piper(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_ADAPTER", "piper")
    monkeypatch.setenv("PIPER_MODEL_PATH", str(default_model_path()))
    adapter = build_tts_adapter()
    assert isinstance(adapter, PiperTtsAdapter)


def test_tts_factory_piper_missing_model_fails_loudly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_ADAPTER", "piper")
    monkeypatch.setenv("PIPER_MODEL_PATH", "/nonexistent/model.onnx")
    with pytest.raises(FileNotFoundError, match="Piper model not found"):
        build_tts_adapter()
