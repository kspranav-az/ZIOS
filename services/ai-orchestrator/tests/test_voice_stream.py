"""Integration test for the voice-mode WebSocket turn loop."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator

import pytest
import websockets

ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "ws://localhost:8000")
API_URL = os.environ.get("API_URL", "http://localhost:3000")


async def _create_voice_session() -> tuple[str, str, str]:
    """Create an admin, voice kit, invite, consent and return session info."""
    import aiohttp

    async with aiohttp.ClientSession() as session:
        admin_email = f"voice-admin-{uuid.uuid4().hex[:8]}@e2e.local"

        # Admin OTP
        await session.post(f"{API_URL}/auth/otp/request", json={"email": admin_email})
        # Mailpit is not guaranteed to be clean; for local integration tests we
        # accept that otp_required defaults to false for invites created by admin.
        async with session.post(
            f"{API_URL}/auth/otp/request",
            json={"email": admin_email},
        ) as resp:
            resp.raise_for_status()
        # Verify with a dummy code only works if the backend allows it in dev; skip.
        # Instead, use a fixed seed admin if available. For this test we create a
        # session via a direct DB helper is too complex; we rely on the public API.
        # To keep the test hermetic, we create a voice session through the invite flow.

        # Create kit
        async with session.post(
            f"{API_URL}/kits",
            json={"title": "Voice Kit", "role": "Engineer", "level": "Mid"},
        ) as resp:
            resp.raise_for_status()
            kit = (await resp.json())["kit"]

        # Add question
        await session.post(
            f"{API_URL}/kits/{kit['id']}/questions",
            json={
                "type": "open_ended",
                "prompt": "Tell us about a project.",
                "topic": "Experience",
                "timeLimitSec": 120,
                "timeLimitType": "soft",
                "mandatory": True,
                "followupPolicy": "none",
                "rubricLines": [{"id": str(uuid.uuid4()), "text": "Clarity", "weight": 1}],
            },
        )

        # Publish
        async with session.post(f"{API_URL}/kits/{kit['id']}/publish") as resp:
            resp.raise_for_status()
            version = (await resp.json())["version"]

        # Create invite
        candidate_email = f"voice-candidate-{uuid.uuid4().hex[:8]}@e2e.local"
        async with session.post(
            f"{API_URL}/invites",
            json={
                "kitVersionId": version["id"],
                "candidate": {"name": "Voice Alice", "email": candidate_email},
            },
        ) as resp:
            resp.raise_for_status()
            invite = await resp.json()

        # Consent
        async with session.post(
            f"{API_URL}/invites/by-token/{invite['token']}/consent",
            json={"name": "Voice Alice", "email": candidate_email},
        ) as resp:
            resp.raise_for_status()
            body = await resp.json()
            return body["session"]["id"], body["recoveryToken"], invite["token"]


async def _drain_audio() -> AsyncIterator[bytes]:
    for _ in range(20):
        yield b"\x00" * 320
        await asyncio.sleep(0.01)


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_VOICE_E2E") != "1",
    reason="set RUN_VOICE_E2E=1 to run the live orchestrator integration test",
)
async def test_voice_stream_turn_loop() -> None:
    """End-to-end voice turn via orchestrator WebSocket."""
    session_id, recovery_token, _token = await _create_voice_session()

    # Issue voice token
    async with websockets.connect(f"{ORCHESTRATOR_URL}/voice/sessions/{session_id}/token") as ws:
        await ws.send(json.dumps({"recoveryToken": recovery_token}))
        payload = json.loads(await ws.recv())

    orchestrator_ws = payload["orchestrator"]["wsUrl"]
    full_ws_url = orchestrator_ws
    if full_ws_url.startswith("/"):
        full_ws_url = (
            ORCHESTRATOR_URL.replace("ws://", "ws://").replace("wss://", "wss://") + full_ws_url
        )

    events: list[dict] = []
    async with websockets.connect(full_ws_url) as ws:
        await ws.send(json.dumps({"type": "start_turn"}))
        async for chunk in _drain_audio():
            await ws.send(json.dumps({"type": "audio_chunk", "data": chunk.hex()}))
            await asyncio.sleep(0.02)
        await ws.send(json.dumps({"type": "end_turn"}))

        # Collect events until telemetry is received or timeout.
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                event = json.loads(msg)
                events.append(event)
                if event.get("type") == "telemetry":
                    break
        except TimeoutError:
            pass

    types = {e.get("type") for e in events}
    assert "stt_partial" in types
    assert "stt_final" in types
    assert "ai_text" in types
    assert "telemetry" in types
    telemetry = next(e for e in events if e["type"] == "telemetry")["telemetry"]
    assert telemetry["totalTurnMs"] > 0
    assert telemetry["transcript"]
