"""Gemini TTS adapter: ``gemini-3.8-flash-lite-tts`` behind the streaming TtsPort.

Cloud text-to-speech via the Gemini API ``generateContent`` speech endpoint
(``responseModalities: ["AUDIO"]`` + ``speechConfig.voiceConfig``). The API
returns ``inlineData`` base64 audio — a mono PCM16 WAV whose sample rate we
read from the container (nominally 24 kHz) and resample to the shared wire
contract (24000 Hz, see ``app.voice.mock_tts``) only when it differs, so the
WebSocket contract and all frontend playback code stay untouched.

Design constraints (mirroring ``app.voice.piper_tts``):

- Sentence buffering is identical to Piper: buffer THROUGH a real sentence
  terminator and flush the remainder at stream end as the final chunk.
  Synthesizing a provider call per bare word mid-stream produces rising,
  staccato intonation (found live as the "high pitched" conductor voice).
- Fail loud, never fake: HTTP errors and malformed payloads raise; the voice
  service catches the exception and degrades to the text-only rung, so a
  broken provider can never produce 200-with-silence audio.
- Construction validates configuration (API key present) so a misconfigured
  deployment fails at boot via ``app.voice.tts_factory``, not mid-turn.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import re
import wave
from collections.abc import AsyncIterator
from typing import Any

import httpx
import numpy as np
import soxr
import structlog

from app.voice.models import TtsChunk
from app.voice.ports import TtsPort

logger = structlog.get_logger()

# The shared interview-room playback contract (packages/interview-room).
WIRE_SAMPLE_RATE = 24000

# Buffer text THROUGH a sentence terminator (same regex discipline as Piper).
SENTENCE_END_RE = re.compile(r"[^.!?]+[.!?]+")

_DEFAULT_MODEL = "gemini-3.8-flash-lite-tts"
_DEFAULT_VOICE = "Puck"
_GENERATE_CONTENT_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
# First sentence latency dominates perceived responsiveness; total timeout
# must still absorb a long final sentence on a cold connection.
_TIMEOUT = httpx.Timeout(connect=5.0, read=45.0, write=10.0, pool=10.0)


class GeminiTtsAdapter(TtsPort):
    """Gemini speech-generation TTS behind the streaming TtsPort contract."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        voice: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = (api_key or os.environ.get("GEMINI_API_KEY") or "").strip()
        if not self._api_key:
            raise ValueError(
                "GeminiTtsAdapter requires GEMINI_API_KEY or an explicit api_key"
            )
        self._model = (model or os.environ.get("GEMINI_TTS_MODEL") or _DEFAULT_MODEL).strip()
        self._voice = (voice or os.environ.get("GEMINI_TTS_VOICE") or _DEFAULT_VOICE).strip()
        # Injectable client keeps contract tests hermetic (httpx.MockTransport).
        self._client = client or httpx.AsyncClient(timeout=_TIMEOUT)
        self._owns_client = client is None
        self._chunks_seen = 0
        logger.info(
            "gemini_tts_loaded",
            model=self._model,
            voice=self._voice,
            wire_sample_rate=WIRE_SAMPLE_RATE,
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def _decode_wav_to_wire_pcm(self, wav_bytes: bytes) -> bytes:
        """Parse the returned WAV and resample to the wire rate when needed."""
        try:
            with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
                channels = wav.getnchannels()
                sample_width = wav.getsampwidth()
                source_rate = wav.getframerate()
                frames = wav.readframes(wav.getnframes())
        except wave.Error as exc:
            raise ValueError(f"Gemini TTS returned unparseable WAV audio: {exc}") from exc
        if sample_width != 2:
            raise ValueError(
                f"Gemini TTS returned {sample_width * 8}-bit audio; expected 16-bit PCM"
            )
        if channels != 1:
            # Downmix defensively rather than rejecting — the wire is mono.
            stereo = np.frombuffer(frames, dtype=np.int16).reshape(-1, channels)
            mono = stereo.mean(axis=1)
            frames = mono.astype(np.int16).tobytes()
        if source_rate == WIRE_SAMPLE_RATE:
            return frames
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        resampled: np.ndarray[Any, Any] = soxr.resample(
            samples, source_rate, WIRE_SAMPLE_RATE
        )
        return (np.clip(resampled, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()

    async def _synthesize_sentence(self, sentence: str, voice: str | None = None) -> bytes:
        url = _GENERATE_CONTENT_URL.format(model=self._model)
        payload = {
            "contents": [{"parts": [{"text": sentence}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": voice or self._voice},
                    },
                },
            },
        }
        response = await self._client.post(
            url,
            params={"key": self._api_key},
            json=payload,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Gemini TTS HTTP {response.status_code}: "
                f"{response.text[:300]}"
            )
        body = response.json()
        inline = self._extract_inline_audio(body)
        return self._decode_wav_to_wire_pcm(inline)

    @staticmethod
    def _extract_inline_audio(body: Any) -> bytes:
        try:
            parts = body["candidates"][0]["content"]["parts"]
            for part in parts:
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    return base64.b64decode(inline["data"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ValueError(f"Gemini TTS response missing audio payload: {exc}") from exc
        raise ValueError("Gemini TTS response contained no inline audio part")

    async def synthesize_stream(
        self,
        text_stream: AsyncIterator[str],
        language_hint: str | None = None,
        voice_id: str | None = None,
    ) -> AsyncIterator[TtsChunk]:
        voice = (voice_id or "").strip() or self._voice
        buffered = ""
        async for text in text_stream:
            buffered += text
            while True:
                match = SENTENCE_END_RE.match(buffered)
                if not match:
                    break
                sentence = match.group(0).strip()
                buffered = buffered[match.end() :]
                if not sentence:
                    continue
                pcm = await self._synthesize_sentence(sentence, voice)
                self._chunks_seen += 1
                yield TtsChunk(audio_bytes=pcm, text=sentence, is_final=False)
                await asyncio.sleep(0)
        if buffered.strip():
            sentence = buffered.strip()
            pcm = await self._synthesize_sentence(sentence, voice)
            self._chunks_seen += 1
            yield TtsChunk(audio_bytes=pcm, text=sentence, is_final=True)

    async def healthcheck(self) -> dict[str, object]:
        return {
            "status": "healthy",
            "provider": "gemini",
            "model": self._model,
            "voice": self._voice,
            "sample_rate": WIRE_SAMPLE_RATE,
            "chunks_seen": self._chunks_seen,
        }
