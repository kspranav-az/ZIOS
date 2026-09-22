"""HTTP client to the API monolith's session conductor endpoints."""

from __future__ import annotations

import os
from typing import Any

import aiohttp
import structlog

logger = structlog.get_logger()

DEFAULT_API_BASE_URL = os.environ.get("API_BASE_URL", "http://api:3000")


class ConductorClient:
    """Thin async client for the monolith session turn API."""

    def __init__(self, base_url: str = DEFAULT_API_BASE_URL) -> None:
        self.base_url = base_url.rstrip("/")
        self._session: aiohttp.ClientSession | None = None

    async def _session_instance(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"Content-Type": "application/json"},
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def turn(
        self,
        session_id: str,
        recovery_token: str,
        answer: str | None = None,
    ) -> dict[str, Any]:
        """Submit a turn and return the monolith response."""
        url = f"{self.base_url}/sessions/{session_id}/turn"
        body: dict[str, Any] = {}
        if answer is not None:
            body["answer"] = answer
        session = await self._session_instance()
        async with session.post(
            url,
            json=body,
            headers={"x-recovery-token": recovery_token},
        ) as response:
            response.raise_for_status()
            payload: dict[str, Any] = await response.json()
            return payload

    async def fallback_to_text(
        self,
        session_id: str,
        recovery_token: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Request voice-to-text fallback."""
        url = f"{self.base_url}/sessions/{session_id}/voice/fallback"
        session = await self._session_instance()
        async with session.post(
            url,
            json={"reason": reason} if reason else {},
            headers={"x-recovery-token": recovery_token},
        ) as response:
            response.raise_for_status()
            payload: dict[str, Any] = await response.json()
            return payload

    async def telemetry(
        self,
        session_id: str,
        recovery_token: str,
        turn: dict[str, Any],
    ) -> None:
        """Report per-turn telemetry to the monolith."""
        url = f"{self.base_url}/sessions/{session_id}/voice/telemetry"
        session = await self._session_instance()
        async with session.post(
            url,
            json={"turn": turn},
            headers={"x-recovery-token": recovery_token},
        ) as response:
            response.raise_for_status()

    async def recording_notification(
        self,
        session_id: str,
        recovery_token: str,
        recording: dict[str, Any],
        media_kind: str | None = None,
    ) -> None:
        """Attach the uploaded session recording to the telemetry endpoint.

        Sent with a top-level ``recording`` key (not wrapped in ``turn``) so
        the API's recording hook can pick it up and enqueue media analysis.
        """
        url = f"{self.base_url}/sessions/{session_id}/voice/telemetry"
        body: dict[str, Any] = {"recording": recording}
        if media_kind is not None:
            body["media_kind"] = media_kind
        session = await self._session_instance()
        async with session.post(
            url,
            json=body,
            headers={"x-recovery-token": recovery_token},
        ) as response:
            response.raise_for_status()
