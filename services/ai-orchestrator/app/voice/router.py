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
from app.storage import StorageClient
from app.voice.mock_stt import MockSttAdapter
from app.voice.mock_tts import MockTtsAdapter
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


@router.post("/sessions/{session_id}/token")
async def issue_voice_token(session_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Issue a LiveKit token and return orchestrator connection info."""
    recovery_token = body.get("recoveryToken", "")
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
            conductor=ConductorClient(),
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
            await websocket.send_json(event)
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
        # Persist the local audio buffer to S3-compatible storage (X8: captured
        # only after consent; the API validated consent before issuing the token).
        if audio_buffer:
            try:
                storage = StorageClient()
                ref = storage.upload_recording(session_id, bytes(audio_buffer))
                await service.conductor.telemetry(
                    session_id,
                    service.recovery_token,
                    {"recording": ref},
                )
            except Exception as exc:
                logger.warning(
                    "recording_upload_failed",
                    session_id=session_id,
                    error=str(exc),
                )
