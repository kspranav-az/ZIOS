"""Piper local TTS adapter (Phase 12f): VITS via ONNX Runtime + espeak-ng.

Real, CPU-only text-to-speech with no API key — the first real ``TtsPort``
implementation. Piper emits int16 mono PCM at the voice's sample rate
(22050 Hz for the en_US-lessac voices); this adapter resamples to the wire
contract rate (24000 Hz, see ``app.voice.mock_tts``) with soxr so the
WebSocket contract and all frontend playback code stay untouched.

Sentence buffering mirrors ``MockTtsAdapter`` exactly: fragments are
buffered and synthesized per sentence, with a trailing punctuation-less
fragment flushed as the final chunk.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import numpy as np
import soxr
import structlog
from piper.voice import PiperVoice

from app.voice.mock_tts import SENTENCE_RE
from app.voice.models import TtsChunk
from app.voice.ports import TtsPort

logger = structlog.get_logger()

# The shared interview-room playback contract (packages/interview-room).
WIRE_SAMPLE_RATE = 24000

_DEFAULT_MODEL = "en_US-lessac-medium.onnx"


def default_model_path() -> Path:
    """<repo>/services/ai-orchestrator/models/<model> (never committed)."""
    return Path(__file__).resolve().parents[2] / "models" / _DEFAULT_MODEL


class PiperTtsAdapter(TtsPort):
    """CPU neural TTS behind the streaming TtsPort contract."""

    def __init__(self, model_path: str | None = None) -> None:
        env_path = os.environ.get("PIPER_MODEL_PATH")
        self._model_path = Path(model_path or env_path or default_model_path())
        if not self._model_path.exists():
            raise FileNotFoundError(
                f"Piper model not found at {self._model_path} — download it "
                f"(see phases/phase-12f-piper-local-tts.md) or set PIPER_MODEL_PATH."
            )
        # PiperVoice.load resolves the <model>.json config next to the .onnx.
        self._voice: Any = PiperVoice.load(str(self._model_path))
        self._source_rate: int = int(self._voice.config.sample_rate)
        self._chunks_seen = 0
        logger.info(
            "piper_tts_loaded",
            model=str(self._model_path),
            source_sample_rate=self._source_rate,
            wire_sample_rate=WIRE_SAMPLE_RATE,
        )

    def _resample_to_wire(self, pcm: bytes) -> bytes:
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        resampled: np.ndarray[Any, Any] = soxr.resample(
            samples, self._source_rate, WIRE_SAMPLE_RATE
        )
        return (np.clip(resampled, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()

    def _synthesize_sentence(self, sentence: str) -> bytes:
        # piper-tts 1.8: synthesize() yields AudioChunks (int16 PCM at the
        # voice's native rate); join them, then resample to the wire rate.
        pcm = b"".join(bytes(chunk.audio_int16_bytes) for chunk in self._voice.synthesize(sentence))
        return self._resample_to_wire(bytes(pcm))

    async def synthesize_stream(
        self,
        text_stream: AsyncIterator[str],
        language_hint: str | None = None,
        voice_id: str | None = None,
    ) -> AsyncIterator[TtsChunk]:
        buffered = ""
        async for text in text_stream:
            buffered += text
            while True:
                match = SENTENCE_RE.match(buffered)
                if not match:
                    break
                sentence = match.group(0).strip()
                buffered = buffered[match.end() :]
                if not sentence:
                    continue
                # Piper blocks on CPU inference — keep it off the event loop.
                pcm = await asyncio.to_thread(self._synthesize_sentence, sentence)
                self._chunks_seen += 1
                yield TtsChunk(audio_bytes=pcm, text=sentence, is_final=False)
                await asyncio.sleep(0)
        if buffered.strip():
            sentence = buffered.strip()
            pcm = await asyncio.to_thread(self._synthesize_sentence, sentence)
            self._chunks_seen += 1
            yield TtsChunk(audio_bytes=pcm, text=sentence, is_final=True)

    async def healthcheck(self) -> dict[str, object]:
        return {
            "status": "healthy",
            "provider": "piper",
            "model": str(self._model_path),
            "sample_rate": WIRE_SAMPLE_RATE,
            "source_sample_rate": self._source_rate,
            "chunks_seen": self._chunks_seen,
        }
