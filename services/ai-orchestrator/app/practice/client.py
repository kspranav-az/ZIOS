"""Practice conductor client (Phase 12e).

Points the orchestrator's voice turn loop at the Ascend practice engine's
orchestrator-facing routes, which authenticate by practice recovery token
only — the same trust posture as the company-interview conductor endpoint
(/sessions/:id/turn). Company sessions keep using ConductorClient unchanged.
"""

from __future__ import annotations

from typing import Any

from app.conductor_client import ConductorClient


class PracticeConductorClient(ConductorClient):
    """ConductorClient variant for live practice sessions."""

    async def turn(
        self,
        session_id: str,
        recovery_token: str,
        answer: str | None = None,
    ) -> dict[str, Any]:
        """Submit a turn and return the practice engine response."""
        url = f"{self.base_url}/cand/practice/conductor/{session_id}/turn"
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

    async def telemetry(
        self,
        session_id: str,
        recovery_token: str,
        turn: dict[str, Any],
    ) -> None:
        """Report per-turn telemetry to the practice telemetry sink."""
        url = f"{self.base_url}/cand/practice/conductor/{session_id}/telemetry"
        session = await self._session_instance()
        async with session.post(
            url,
            json={"turn": turn},
            headers={"x-recovery-token": recovery_token},
        ) as response:
            response.raise_for_status()

    async def fallback_to_text(
        self,
        session_id: str,
        recovery_token: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Practice has no voice→text fallback route; a turn with no answer
        re-presents the current question so the candidate can continue in the
        UI, which is exactly the fallback semantics the practice engine
        already implements."""
        return await self.turn(session_id, recovery_token, None)

    async def recording_notification(
        self,
        session_id: str,
        recovery_token: str,
        recording: dict[str, Any],
        media_kind: str | None = None,
    ) -> None:
        """Practice recordings have no analysis consumer today; accept and
        drop so the persist path stays uniform."""
        return None
