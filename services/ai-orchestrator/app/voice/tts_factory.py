"""Selects the concrete ``TtsPort`` implementation from ``TTS_ADAPTER``.

Mirrors ``app/analysis/stt/factory.py``: gemini is the default real voice
(``gemini-3.8-flash-lite-tts``, requires ``GEMINI_API_KEY``); piper is the
local offline neural voice; mock is synthetic silence for tests/CI. Gemini
without a key degrades to mock with a loud warning so hermetic environments
still boot. Unknown values fail loudly at build time, not mid-turn.
"""

from __future__ import annotations

import os

import structlog

from app.voice.gemini_tts import GeminiTtsAdapter
from app.voice.mock_tts import MockTtsAdapter
from app.voice.piper_tts import PiperTtsAdapter
from app.voice.ports import TtsPort

logger = structlog.get_logger()

_VALID = ("mock", "piper", "gemini")


def build_tts_adapter() -> TtsPort:
    name = os.environ.get("TTS_ADAPTER", "gemini").strip().lower() or "gemini"
    if name == "mock":
        logger.info("tts_adapter_selected", adapter="mock")
        return MockTtsAdapter()
    if name == "piper":
        logger.info("tts_adapter_selected", adapter="piper")
        return PiperTtsAdapter()
    if name == "gemini":
        try:
            adapter = GeminiTtsAdapter()
        except ValueError as exc:
            # Gemini is the default: a keyless environment (CI, fresh clone)
            # must still boot — loudly, not silently.
            logger.warning("tts_gemini_unavailable_falling_back_to_mock", error=str(exc))
            return MockTtsAdapter()
        logger.info("tts_adapter_selected", adapter="gemini")
        return adapter
    raise ValueError(f"unknown TTS_ADAPTER {name!r}; expected one of: {', '.join(_VALID)}")
