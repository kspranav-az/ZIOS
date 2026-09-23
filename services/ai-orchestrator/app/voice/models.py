"""Voice-mode data models shared by the orchestrator."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal


class TurnIntent(StrEnum):
    """Planner output: what should the conductor do next?"""

    PROBE = "probe"
    ADVANCE = "advance"
    CLARIFY = "clarify"
    WRAPUP = "wrapup"


@dataclass
class SttEvent:
    """Streaming STT event from a provider adapter."""

    type: Literal["partial", "final"]
    text: str
    is_final: bool = False
    confidence: float = 1.0
    language: str | None = None


@dataclass
class TtsChunk:
    """Streaming TTS audio chunk from a provider adapter."""

    audio_bytes: bytes
    text: str
    is_final: bool = False


@dataclass
class TurnTelemetry:
    """Per-turn latency and quality telemetry (X6)."""

    turn_index: int
    vad_ms: int
    stt_final_ms: int
    planner_ms: int
    tts_first_audio_ms: int
    total_turn_ms: int
    transcript: str
    barged_in: bool = False
    degradation_rung: Literal["tts_text", "stt_text", "ai_pause", None] = None

    def to_wire_dict(self) -> dict[str, Any]:
        """camelCase JSON shape — the same mapping the conductor telemetry
        callback posts to the API, so the WS stream and the callback cannot
        drift."""
        return {
            "turnIndex": self.turn_index,
            "vadMs": self.vad_ms,
            "sttFinalMs": self.stt_final_ms,
            "plannerMs": self.planner_ms,
            "ttsFirstAudioMs": self.tts_first_audio_ms,
            "totalTurnMs": self.total_turn_ms,
            "transcript": self.transcript,
            "bargedIn": self.barged_in,
            "degradationRung": self.degradation_rung,
        }


@dataclass
class VoiceTurnResult:
    """Result of one AI turn."""

    question_id: str | None
    text: str
    intent: TurnIntent
    telemetry: TurnTelemetry


@dataclass
class VoiceSessionState:
    """Runtime state for an active voice session."""

    session_id: str
    room_name: str
    turn_index: int = 0
    is_ai_speaking: bool = False
    current_tts_task: object | None = None
    degradation_rung: Literal["tts_text", "stt_text", "ai_pause", None] = None
    transcript_buffer: list[dict[str, object]] = field(default_factory=list)
