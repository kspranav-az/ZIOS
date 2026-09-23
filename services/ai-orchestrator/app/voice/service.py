"""Voice session service: turn loop, barge-in, degradation ladder, telemetry."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

import structlog

from app.conductor_client import ConductorClient
from app.voice.models import (
    TtsChunk,
    TurnIntent,
    TurnTelemetry,
    VoiceSessionState,
)
from app.voice.ports import SttPort, TtsPort

logger = structlog.get_logger()

# Cheap intent classifier based on turn index. In production this is a small
# dedicated model; mock mode uses deterministic rules so tests are stable.
INTENT_SEQUENCE: list[TurnIntent] = [
    TurnIntent.PROBE,
    TurnIntent.ADVANCE,
    TurnIntent.CLARIFY,
    TurnIntent.ADVANCE,
    TurnIntent.WRAPUP,
]

# Backchannels triggered between turns to signal listening.
BACKCHANNELS = ["mm-hmm", "got it", "I see"]


class VoiceSessionService:
    """Runs one voice interview session end-to-end.

    The service is intentionally decoupled from WebSocket/transport details.
    Callers feed audio chunks to `process_turn` and receive outbound events
    (transcript partials, AI text, TTS audio) through an async iterator.
    """

    def __init__(
        self,
        session_id: str,
        room_name: str,
        recovery_token: str,
        stt: SttPort,
        tts: TtsPort,
        conductor: ConductorClient,
        language: str = "en",
        mode: str = "voice",
        practice: bool = False,
    ) -> None:
        self.state = VoiceSessionState(session_id=session_id, room_name=room_name)
        self.recovery_token = recovery_token
        self.stt = stt
        self.tts = tts
        self.conductor = conductor
        self.language = language
        # Interview mode reported by the API ("voice" | "video"); video-mode
        # sessions additionally run a LiveKit track capture (Phase 14).
        self.mode = mode
        # Live practice sessions (Phase 12e): practice conductor client,
        # no company-only callbacks (integrity/analysis notification).
        self.practice = practice
        self._shutting_down = False

    async def _classify_intent(self, turn_index: int, transcript: str) -> TurnIntent:
        # Deterministic mock planner.
        if "stop" in transcript.lower() or "end" in transcript.lower():
            return TurnIntent.WRAPUP
        return INTENT_SEQUENCE[min(turn_index, len(INTENT_SEQUENCE) - 1)]

    async def _planner_latency_ms(self) -> int:
        # Simulate ~600 ms planner latency with jitter.
        await asyncio.sleep(0.55)
        return 600

    async def _call_conductor(self, answer: str | None) -> dict[str, Any]:
        """Get the next turn from the monolith conductor."""
        return await self.conductor.turn(
            self.state.session_id,
            self.recovery_token,
            answer,
        )

    async def _tts_stream_for_text(
        self,
        text: str,
    ) -> AsyncIterator[TtsChunk]:
        async def _text_gen() -> AsyncIterator[str]:
            # Yield text word-by-word to exercise streaming chunking.
            for word in text.split():
                yield word + " "

        try:
            async for chunk in self.tts.synthesize_stream(_text_gen(), self.language):
                yield chunk
        except Exception as exc:
            logger.warning(
                "tts_stream_failed",
                session_id=self.state.session_id,
                error=str(exc),
            )
            raise

    async def process_turn(
        self,
        audio_stream: AsyncIterator[bytes],
    ) -> AsyncIterator[dict[str, Any]]:
        """Process one candidate turn and yield orchestrator events.

        Events:
          {type: "stt_partial", text: str}
          {type: "stt_final", text: str}
          {type: "ai_text", text: str, intent: str}
          {type: "tts_audio", audio_base64: str, text: str}
          {type: "telemetry", telemetry: TurnTelemetry}
          {type: "error", code: str, message: str}
        """
        start = time.monotonic()
        self.state.turn_index += 1
        turn_index = self.state.turn_index
        vad_ms = 200  # Mock VAD latency.
        transcript = ""
        barged_in = False

        # Cancel any in-flight TTS from a previous turn (barge-in).
        if self.state.is_ai_speaking:
            self.state.is_ai_speaking = False
            barged_in = True
            yield {"type": "barge_in", "turn_index": turn_index}

        stt_start = time.monotonic()
        try:
            async for event in self.stt.transcribe_stream(audio_stream, self.language):
                if event.type == "partial":
                    yield {"type": "stt_partial", "text": event.text}
                else:
                    transcript = event.text
                    stt_final_ms = int((time.monotonic() - stt_start) * 1000)
                    yield {"type": "stt_final", "text": transcript}
                    break
        except Exception as exc:
            logger.warning(
                "stt_failure",
                session_id=self.state.session_id,
                error=str(exc),
            )
            self.state.degradation_rung = "stt_text"
            stt_final_ms = int((time.monotonic() - stt_start) * 1000)
            transcript = ""
            yield {
                "type": "error",
                "code": "STT_FAILURE",
                "message": "Speech recognition failed; switching to text fallback.",
            }

        # If STT is degraded to text, we stop here and let the client submit
        # a text answer through the normal API turn endpoint.
        if self.state.degradation_rung == "stt_text":
            total_ms = int((time.monotonic() - start) * 1000)
            telemetry = TurnTelemetry(
                turn_index=turn_index,
                vad_ms=vad_ms,
                stt_final_ms=stt_final_ms,
                planner_ms=0,
                tts_first_audio_ms=0,
                total_turn_ms=total_ms,
                transcript=transcript,
                barged_in=barged_in,
                degradation_rung="stt_text",
            )
            await self._report_telemetry(telemetry)
            yield {"type": "telemetry", "telemetry": telemetry}
            return

        # Planner.
        planner_start = time.monotonic()
        intent = await self._classify_intent(turn_index, transcript)
        planner_ms = await self._planner_latency_ms()
        planner_ms = int((time.monotonic() - planner_start) * 1000)

        # Conductor: get next AI turn.
        try:
            conductor_response = await self._call_conductor(transcript)
        except Exception as exc:
            logger.warning(
                "conductor_failure",
                session_id=self.state.session_id,
                error=str(exc),
            )
            self.state.degradation_rung = "ai_pause"
            total_ms = int((time.monotonic() - start) * 1000)
            telemetry = TurnTelemetry(
                turn_index=turn_index,
                vad_ms=vad_ms,
                stt_final_ms=stt_final_ms,
                planner_ms=planner_ms,
                tts_first_audio_ms=0,
                total_turn_ms=total_ms,
                transcript=transcript,
                barged_in=barged_in,
                degradation_rung="ai_pause",
            )
            await self._report_telemetry(telemetry)
            yield {"type": "telemetry", "telemetry": telemetry}
            yield {
                "type": "error",
                "code": "AI_PAUSE",
                "message": "AI is taking longer than expected. Please wait or resume.",
            }
            return

        turn = conductor_response.get("turn", {})
        ai_text = turn.get("text", "")
        yield {"type": "ai_text", "text": ai_text, "intent": intent.value}

        # TTS streaming with first-audio latency measurement.
        tts_first_audio_ms = 0
        tts_failed = False
        tts_start = time.monotonic()
        try:
            async for chunk in self._tts_stream_for_text(ai_text):
                if tts_first_audio_ms == 0:
                    tts_first_audio_ms = int((time.monotonic() - tts_start) * 1000)
                self.state.is_ai_speaking = True
                if self.state.degradation_rung == "tts_text":
                    # Already degraded: send text only.
                    yield {"type": "ai_text", "text": chunk.text}
                else:
                    yield {
                        "type": "tts_audio",
                        "audio_base64": chunk.audio_bytes.hex(),
                        "text": chunk.text,
                    }
            self.state.is_ai_speaking = False
        except Exception as exc:
            logger.warning(
                "tts_failure",
                session_id=self.state.session_id,
                error=str(exc),
            )
            tts_failed = True
            self.state.degradation_rung = "tts_text"
            # Continue by sending the AI text so the candidate can read it.
            yield {"type": "ai_text", "text": ai_text}

        total_ms = int((time.monotonic() - start) * 1000)
        telemetry = TurnTelemetry(
            turn_index=turn_index,
            vad_ms=vad_ms,
            stt_final_ms=stt_final_ms,
            planner_ms=planner_ms,
            tts_first_audio_ms=tts_first_audio_ms if not tts_failed else 0,
            total_turn_ms=total_ms,
            transcript=transcript,
            barged_in=barged_in,
            degradation_rung=self.state.degradation_rung,
        )
        await self._report_telemetry(telemetry)
        yield {"type": "telemetry", "telemetry": telemetry}

        # Cheap backchannel before ending the turn stream.
        if turn_index < len(BACKCHANNELS):
            yield {"type": "backchannel", "text": BACKCHANNELS[turn_index]}

    async def _report_telemetry(self, telemetry: TurnTelemetry) -> None:
        try:
            await self.conductor.telemetry(
                self.state.session_id,
                self.recovery_token,
                telemetry.to_wire_dict(),
            )
        except Exception as exc:
            logger.warning(
                "telemetry_report_failed",
                session_id=self.state.session_id,
                error=str(exc),
            )

    async def fallback_to_text(self, reason: str | None = None) -> dict[str, Any]:
        """Move the session to text mode and return the current turn."""
        return await self.conductor.fallback_to_text(
            self.state.session_id,
            self.recovery_token,
            reason,
        )
