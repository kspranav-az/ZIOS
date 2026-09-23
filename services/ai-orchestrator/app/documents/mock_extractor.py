"""Mock text extractor for contract tests and stubbed environments.

Ignores the bytes entirely and returns a deterministic fixture profile, the
same contract the real extractor must satisfy (non-empty text for valid
input, ValueError for declared-but-unparseable input when the caller marks
it corrupt).
"""

from __future__ import annotations

import structlog

from app.documents.ports import TextExtractorPort

logger = structlog.get_logger()

FIXTURE_TEXT = (
    "Priya Sharma\n"
    "priya@example.com\n\n"
    "Backend engineer with 5 years of experience building distributed\n"
    "systems in TypeScript, Python, and Go. Led a migration to event-driven\n"
    "microservices serving 2M daily users.\n\n"
    "Skills: TypeScript, Python, Go, PostgreSQL, Redis, Kafka, Docker, AWS\n"
)


class MockTextExtractor(TextExtractorPort):
    """Fixture extractor: returns canned resume text for any bytes."""

    async def extract_text(self, content: bytes, content_type: str) -> str:
        logger.info("mock_extract_text", content_type=content_type, bytes=len(content))
        return FIXTURE_TEXT

    async def healthcheck(self) -> dict[str, object]:
        return {"status": "healthy", "adapter": "mock"}
