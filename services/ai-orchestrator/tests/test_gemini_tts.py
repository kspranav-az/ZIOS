"""Contract tests for the Gemini TTS adapter and the TTS_ADAPTER factory.

Hermetic: the HTTP layer is an ``httpx.MockTransport`` serving deterministic
``generateContent`` responses (WAV fixtures generated in-memory), so no real
API key or network is needed. The live test at the bottom is opt-in via
``GEMINI_API_KEY``.
"""

from __future__ import annotations

import base64
import io
import json
import math
import os
import wave
from collections.abc import AsyncIterator

import httpx
import numpy as np
import pytest

from app.voice.gemini_tts import WIRE_SAMPLE_RATE, GeminiTtsAdapter
from app.voice.tts_factory import build_tts_adapter

_TEST_KEY = "test-key"


def _tone_wav(sample_rate: int, seconds: float = 0.25, freq_hz: float = 440.0) -> bytes:
    """Deterministic PCM16 mono WAV of a sine tone at the given rate."""
    n_samples = int(sample_rate * seconds)
    t = np.arange(n_samples, dtype=np.float32) / sample_rate
    pcm = (np.sin(2 * math.pi * freq_hz * t) * 20000).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buf.getvalue()


def _tts_response(wav_bytes: bytes) -> dict[str, object]:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "audio/wav",
                                "data": base64.b64encode(wav_bytes).decode("ascii"),
                            }
                        }
                    ]
                }
            }
        ]
    }


def _adapter(handler: httpx.MockTransport) -> GeminiTtsAdapter:
    client = httpx.AsyncClient(transport=handler, base_url="https://example.test")
    return GeminiTtsAdapter(api_key=_TEST_KEY, model="gemini-3.8-flash-lite-tts", client=client)


def _ok_transport(wav_bytes: bytes | None = None) -> httpx.MockTransport:
    """MockTransport that serves a successful TTS response for every call."""
    wav = wav_bytes if wav_bytes is not None else _tone_wav(WIRE_SAMPLE_RATE)
    return httpx.MockTransport(
        lambda req: httpx.Response(200, json=_tts_response(wav), request=req)
    )


async def _text_stream(words: list[str]) -> AsyncIterator[str]:
    for word in words:
        yield word + " "


class _RecordingHandler:
    """Serves a fixed TTS response and records request bodies/URLs."""

    def __init__(self, wav_bytes: bytes) -> None:
        self.wav_bytes = wav_bytes
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            200,
            json=_tts_response(self.wav_bytes),
            request=request,
        )


@pytest.mark.asyncio
async def test_gemini_tts_contract_chunks_and_text() -> None:
    handler = _RecordingHandler(_tone_wav(WIRE_SAMPLE_RATE))
    adapter = _adapter(httpx.MockTransport(handler.handler))
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["Hello", "world."]))]
    # Sentence buffering: one chunk per terminated sentence, not per word.
    assert len(chunks) == 1
    assert all(len(c.audio_bytes) > 0 and len(c.audio_bytes) % 2 == 0 for c in chunks)
    assert "Hello" in chunks[0].text
    assert "world" in chunks[0].text


@pytest.mark.asyncio
async def test_gemini_tts_outputs_pcm16_mono_non_silence() -> None:
    adapter = _adapter(_ok_transport())
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["Testing", "one", "two."]))]
    pcm = np.frombuffer(b"".join(c.audio_bytes for c in chunks), dtype=np.int16)
    assert len(chunks) >= 1
    assert len(pcm) >= 4000
    assert int(np.abs(pcm).max()) > 100


@pytest.mark.asyncio
async def test_gemini_tts_flushes_punctuationless_remainder_as_final() -> None:
    """No terminal punctuation anywhere: the buffered remainder is flushed at
    stream end as the final chunk (real TTS must not drop trailing text)."""
    adapter = _adapter(_ok_transport())
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["tell me more"]))]
    assert len(chunks) == 1
    assert chunks[0].text == "tell me more"
    assert chunks[0].is_final is True
    assert len(chunks[0].audio_bytes) > 0


@pytest.mark.asyncio
async def test_gemini_tts_resamples_non_wire_sample_rate() -> None:
    """A 16 kHz provider response is resampled up to the 24 kHz wire rate."""
    adapter = _adapter(_ok_transport(_tone_wav(16000)))
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["rate check."]))]
    assert len(chunks) == 1
    pcm = np.frombuffer(chunks[0].audio_bytes, dtype=np.int16)
    # 0.25 s at 16 kHz = 4000 samples → 6000 at 24 kHz (± soxr tail padding).
    assert 5800 <= len(pcm) <= 6200
    assert int(np.abs(pcm).max()) > 100


@pytest.mark.asyncio
async def test_gemini_tts_sends_voice_and_key() -> None:
    handler = _RecordingHandler(_tone_wav(WIRE_SAMPLE_RATE))
    adapter = _adapter(httpx.MockTransport(handler.handler))
    async for _ in adapter.synthesize_stream(_text_stream(["voice check."]), voice_id="Kore"):
        pass
    assert len(handler.requests) == 1
    request = handler.requests[0]
    assert f"key={_TEST_KEY}" in str(request.url)
    body = json.loads(request.content)
    speech_config = body["generationConfig"]["speechConfig"]
    assert speech_config["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Kore"


@pytest.mark.asyncio
async def test_gemini_tts_http_error_raises_loudly() -> None:
    adapter = _adapter(
        httpx.MockTransport(
            lambda req: httpx.Response(429, json={"error": {"message": "quota"}}, request=req)
        )
    )
    with pytest.raises(RuntimeError, match="Gemini TTS HTTP 429"):
        _ = [c async for c in adapter.synthesize_stream(_text_stream(["quota exceeded."]))]


@pytest.mark.asyncio
async def test_gemini_tts_missing_audio_payload_raises_loudly() -> None:
    adapter = _adapter(
        httpx.MockTransport(
            lambda req: httpx.Response(
                200, json={"candidates": [{"content": {"parts": []}}]}, request=req
            )
        )
    )
    with pytest.raises(ValueError, match="no inline audio"):
        _ = [c async for c in adapter.synthesize_stream(_text_stream(["empty."]))]


@pytest.mark.asyncio
async def test_gemini_tts_healthcheck() -> None:
    adapter = _adapter(httpx.MockTransport(lambda req: httpx.Response(200, json={}, request=req)))
    health = await adapter.healthcheck()
    assert health["status"] == "healthy"
    assert health["provider"] == "gemini"
    assert health["model"] == "gemini-3.8-flash-lite-tts"
    assert health["sample_rate"] == WIRE_SAMPLE_RATE


def test_gemini_tts_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        GeminiTtsAdapter()


def test_tts_factory_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TTS_ADAPTER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", _TEST_KEY)
    adapter = build_tts_adapter()
    assert isinstance(adapter, GeminiTtsAdapter)


def test_tts_factory_gemini_missing_key_falls_back_to_mock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """gemini is the default; a keyless environment must still boot (loud
    warning + mock), not crash — the adapter itself stays fail-loud."""
    from app.voice.mock_tts import MockTtsAdapter

    monkeypatch.setenv("TTS_ADAPTER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert isinstance(build_tts_adapter(), MockTtsAdapter)


def test_tts_factory_default_is_gemini_with_mock_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.voice.mock_tts import MockTtsAdapter

    monkeypatch.delenv("TTS_ADAPTER", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert isinstance(build_tts_adapter(), MockTtsAdapter)


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY"),
    reason="GEMINI_API_KEY not set (live probe)",
)
async def test_gemini_tts_live_probe() -> None:
    """One real synthesis against the Gemini API (opt-in via GEMINI_API_KEY)."""
    adapter = GeminiTtsAdapter()
    chunks = [c async for c in adapter.synthesize_stream(_text_stream(["Hello from", "ZIOS."]))]
    assert len(chunks) >= 1
    pcm = np.frombuffer(b"".join(c.audio_bytes for c in chunks), dtype=np.int16)
    assert len(pcm) >= 4000
    assert int(np.abs(pcm).max()) > 100
