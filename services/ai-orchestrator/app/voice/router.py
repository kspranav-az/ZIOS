"""FastAPI routes for the voice orchestrator."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from livekit.api import AccessToken, VideoGrants

from app.conductor_client import ConductorClient
from app.practice import PracticeConductorClient
from app.storage import StorageClient
from app.video.capture import VideoCaptureSession, capture_enabled
from app.voice.mock_stt import MockSttAdapter
from app.voice.mock_tts import MockTtsAdapter
from app.voice.models import TurnTelemetry
from app.voice.service import VoiceSessionService

router = APIRouter(prefix="/voice", tags=["voice"])
logger = structlog.get_logger()

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret")

_orchestrator_tokens: dict[str, str] = {}
_sessions: dict[str, VoiceSessionService] = {}


def _room_name(session_id: str) -> str:
    return f"voice-{session_id}"


def _json_default(value: Any) -> Any:
    """JSON serializer for non-primitive event payloads.

    process_turn yields TurnTelemetry dataclasses inside the "telemetry"
    event; starlette's send_json would raise TypeError and surface to the
    candidate as a STREAM_ERROR, so dataclasses serialize via their explicit
    wire shape. Anything else is a real bug — fail loudly.
    """
    if isinstance(value, TurnTelemetry):
        return value.to_wire_dict()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


@router.post("/sessions/{session_id}/token")
async def issue_voice_token(session_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Issue a LiveKit token and return orchestrator connection info."""
    recovery_token = body.get("recoveryToken", "")
    # Interview mode reported by the API ("voice" | "video"); video-mode
    # sessions additionally run a LiveKit track capture (Phase 14).
    mode = body.get("mode", "voice")
    # Live practice (Phase 12e): the turn loop talks to the practice engine's
    # recovery-token-only conductor routes instead of the company ones.
    practice = body.get("practice") is True
    room_name = _room_name(session_id)
    token = (
        AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(f"candidate-{session_id}")
        .with_name("Candidate")
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
    )
    orchestrator_token = f"orch-{session_id}"
    _orchestrator_tokens[session_id] = orchestrator_token
    # Pre-create the service so the recovery token is available for conductor calls.
    if session_id not in _sessions:
        _sessions[session_id] = VoiceSessionService(
            session_id=session_id,
            room_name=room_name,
            recovery_token=recovery_token,
            stt=MockSttAdapter(),
            tts=MockTtsAdapter(),
            conductor=PracticeConductorClient() if practice else ConductorClient(),
            mode=mode,
            practice=practice,
        )
    return {
        "sessionId": session_id,
        "livekit": {
            "url": LIVEKIT_URL,
            "token": token.to_jwt(),
            "roomName": room_name,
        },
        "orchestrator": {
            "wsUrl": f"/voice/sessions/{session_id}/stream",
            "token": orchestrator_token,
        },
    }


@router.websocket("/sessions/{session_id}/stream")
async def voice_stream(websocket: WebSocket, session_id: str) -> None:
    """WebSocket control channel for a voice interview.

    The client sends JSON messages:
      {"type": "start_turn"}        -> begin listening for audio
      {"type": "audio_chunk", "data": "base64"}
      {"type": "barge_in"}           -> interrupt current AI speech
      {"type": "fallback_to_text", "reason": "optional"}

    The server sends JSON events from VoiceSessionService.process_turn.
    """
    await websocket.accept()
    service = _sessions.get(session_id)
    if service is None:
        await websocket.close(code=4001, reason="session not initialized")
        return

    audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
    audio_buffer = bytearray()

    # Video-mode sessions additionally capture the candidate's LiveKit tracks
    # (Phase 14). Capture is fail-safe: any error is logged and the interview
    # continues with the audio-only recording path.
    capture: VideoCaptureSession | None = None
    if service.mode == "video" and capture_enabled():
        capture = VideoCaptureSession(
            session_id=session_id,
            room_name=service.state.room_name,
            livekit_url=LIVEKIT_URL,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
        )
        try:
            await capture.start()
        except Exception as exc:
            logger.warning(
                "video_capture_start_failed",
                session_id=session_id,
                error=str(exc),
            )
            capture = None

    async def _receive() -> None:
        try:
            while True:
                message = await websocket.receive_text()
                payload = json.loads(message)
                msg_type = payload.get("type")
                if msg_type == "audio_chunk":
                    data = payload.get("data", "")
                    chunk = bytes.fromhex(data)
                    audio_buffer.extend(chunk)
                    audio_queue.put_nowait(chunk)
                elif msg_type == "end_turn":
                    audio_queue.put_nowait(None)
                elif msg_type == "barge_in":
                    service.state.is_ai_speaking = False
                elif msg_type == "fallback_to_text":
                    result = await service.fallback_to_text(payload.get("reason"))
                    await websocket.send_json({"type": "fallback_result", "payload": result})
        except WebSocketDisconnect:
            await audio_queue.put(None)
        except Exception as exc:
            logger.warning("voice_receive_error", session_id=session_id, error=str(exc))
            await audio_queue.put(None)

    receive_task = asyncio.create_task(_receive())

    async def _audio_gen() -> AsyncIterator[bytes]:
        while True:
            chunk = await audio_queue.get()
            if chunk is None:
                return
            yield chunk

    try:
        async for event in service.process_turn(_audio_gen()):
            await websocket.send_text(json.dumps(event, default=_json_default))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("voice_stream_error", session_id=session_id, error=str(exc))
        try:
            await websocket.send_json(
                {"type": "error", "code": "STREAM_ERROR", "message": str(exc)}
            )
        except Exception:
            pass
    finally:
        receive_task.cancel()
        try:
            await receive_task
        except asyncio.CancelledError:
            pass
        await _persist_recording(service, audio_buffer, capture)


async def _persist_recording(
    service: VoiceSessionService,
    audio_buffer: bytearray,
    capture: VideoCaptureSession | None,
) -> None:
    """Upload the session recording and notify the API (X8: captured only
    after consent; the API validated consent before issuing the token).

    Video-mode captures produce a WebM (media_kind "video"); when capture
    yields no usable media — or for plain voice sessions — the buffered
    WS audio is uploaded as WAV (media_kind "audio"), preserving the
    pre-existing behavior.
    """
    session_id = service.state.session_id
    ref: dict[str, Any] | None = None
    media_kind = "audio"
    if capture is not None:
        try:
            webm = await capture.stop()
            if webm:
                ref = StorageClient().upload_recording(
                    session_id,
                    webm,
                    content_type="video/webm",
                    extension=".webm",
                )
                media_kind = "video"
        except Exception as exc:
            logger.warning(
                "video_capture_upload_failed",
                session_id=session_id,
                error=str(exc),
            )
    if ref is None and audio_buffer:
        try:
            ref = StorageClient().upload_recording(session_id, bytes(audio_buffer))
        except Exception as exc:
            logger.warning(
                "recording_upload_failed",
                session_id=session_id,
                error=str(exc),
            )
    if ref is None:
        return
    try:
        await service.conductor.recording_notification(
            session_id,
            service.recovery_token,
            ref,
            media_kind=media_kind,
        )
    except Exception as exc:
        logger.warning(
            "recording_notification_failed",
            session_id=session_id,
            error=str(exc),
        )
