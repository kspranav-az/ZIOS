"""Unit tests for live-practice orchestrator wiring (Phase 12e)."""

from __future__ import annotations

from typing import Any

import pytest

from app.practice import PracticeConductorClient
from app.voice.mock_stt import MockSttAdapter
from app.voice.mock_tts import MockTtsAdapter
from app.voice.service import VoiceSessionService
from tests.test_voice_service import FakeConductor, _audio


class _FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    async def __aenter__(self) -> _FakeResponse:
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    async def json(self) -> dict[str, Any]:
        return self._payload


class _FakeHttpSession:
    """Records requests instead of performing HTTP."""

    closed = False

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def post(self, url: str, json: Any = None, headers: Any = None) -> _FakeResponse:
        self.requests.append({"url": url, "json": json, "headers": headers})
        return _FakeResponse({"turn": {"type": "question", "text": "q", "questionId": "q1"}})


@pytest.mark.asyncio
async def test_practice_client_targets_practice_conductor_routes() -> None:
    client = PracticeConductorClient(base_url="http://api:3000")
    fake = _FakeHttpSession()
    client._session = fake  # type: ignore[assignment]

    await client.turn("s1", "rt", "my answer")
    await client.telemetry("s1", "rt", {"turnIndex": 1})
    await client.fallback_to_text("s1", "rt", reason="candidate-request")

    urls = [r["url"] for r in fake.requests]
    assert urls == [
        "http://api:3000/cand/practice/conductor/s1/turn",
        "http://api:3000/cand/practice/conductor/s1/telemetry",
        "http://api:3000/cand/practice/conductor/s1/turn",
    ]
    assert fake.requests[0]["json"] == {"answer": "my answer"}
    assert fake.requests[0]["headers"] == {"x-recovery-token": "rt"}
    # Fallback = turn with no answer (re-presents the current question).
    assert fake.requests[2]["json"] == {}


@pytest.mark.asyncio
async def test_practice_recording_notification_is_accepted_noop() -> None:
    client = PracticeConductorClient(base_url="http://api:3000")
    await client.recording_notification("s1", "rt", {"objectName": "recordings/s1.wav"})


@pytest.mark.asyncio
async def test_service_carries_practice_flag() -> None:
    service = VoiceSessionService(
        session_id="s1",
        room_name="voice-s1",
        recovery_token="rt",
        stt=MockSttAdapter(fixture="short"),
        tts=MockTtsAdapter(chunk_ms=1),
        conductor=FakeConductor(),
        practice=True,
    )
    assert service.practice is True
    events = [e async for e in service.process_turn(_audio())]
    assert "ai_text" in {e["type"] for e in events}
