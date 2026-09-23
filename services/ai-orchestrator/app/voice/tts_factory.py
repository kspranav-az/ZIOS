"""Selects the concrete ``TtsPort`` implementation from ``TTS_ADAPTER``.

Mirrors ``app/analysis/stt/factory.py``: mock is the hermetic default for
tests/CI; piper is the real local neural voice. Unknown values fail loudly
at build time, not mid-turn.
"""

from __future__ import annotations

import os

import structlog

from app.voice.mock_tts import MockTtsAdapter
from app.voice.piper_tts import PiperTtsAdapter
from app.voice.ports import TtsPort

logger = structlog.get_logger()

_VALID = ("mock", "piper")


def build_tts_adapter() -> TtsPort:
    name = os.environ.get("TTS_ADAPTER", "mock").strip().lower() or "mock"
    if name == "mock":
        logger.info("tts_adapter_selected", adapter="mock")
        return MockTtsAdapter()
    if name == "piper":
        logger.info("tts_adapter_selected", adapter="piper")
        return PiperTtsAdapter()
    raise ValueError(f"unknown TTS_ADAPTER {name!r}; expected one of: {', '.join(_VALID)}")
