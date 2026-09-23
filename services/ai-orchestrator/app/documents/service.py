"""Document text-extraction service (Phase 12b).

The API sends raw file bytes (base64); this service validates them, decodes
text/plain directly, and routes binary documents through the configured
TextExtractorPort. The port is selected by DOCUMENT_EXTRACTION_ADAPTER:
"pypdf" (local library) or "mock" (fixture, default). Unknown values are a
loud boot-time error — silently falling back to a mock in production would
fabricate extraction results.
"""

from __future__ import annotations

import base64
import binascii
import os

import structlog

from app.documents.mock_extractor import MockTextExtractor
from app.documents.ports import TextExtractorPort

logger = structlog.get_logger()

SUPPORTED_CONTENT_TYPES = {"application/pdf", "text/plain"}


def build_extractor() -> TextExtractorPort:
    """Select the extractor from DOCUMENT_EXTRACTION_ADAPTER (default: mock)."""
    adapter = os.environ.get("DOCUMENT_EXTRACTION_ADAPTER", "mock")
    if adapter == "mock":
        logger.info("document_extractor_selected", adapter="mock")
        return MockTextExtractor()
    if adapter == "pypdf":
        from app.documents.pypdf_extractor import PypdfExtractor

        logger.info("document_extractor_selected", adapter="pypdf")
        return PypdfExtractor()
    raise ValueError(
        f"unknown DOCUMENT_EXTRACTION_ADAPTER {adapter!r}; expected one of: mock, pypdf"
    )


class DocumentExtractionService:
    """Validate and extract plain text from an uploaded document."""

    def __init__(self, extractor: TextExtractorPort | None = None) -> None:
        self.extractor = extractor or build_extractor()

    async def extract_text(self, content_base64: str, content_type: str) -> dict[str, str]:
        """Return {"text": ..., "extractor": ...} for the declared content type.

        Raises ValueError for malformed base64, unsupported content types, or
        unparseable documents — the router maps these to a 422.
        """
        bare_type = (content_type or "").split(";")[0].strip().lower()
        if bare_type not in SUPPORTED_CONTENT_TYPES:
            raise ValueError(f"unsupported content_type {content_type!r}")
        try:
            content = base64.b64decode(content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("content_base64 is not valid base64") from exc
        if not content:
            raise ValueError("content decodes to zero bytes")

        if bare_type == "text/plain":
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ValueError("text/plain content is not valid UTF-8") from exc
            extractor_name = "plain"
        else:
            text = await self.extractor.extract_text(content, bare_type)
            extractor_name = type(self.extractor).__name__

        logger.info(
            "document_extracted",
            content_type=bare_type,
            extractor=extractor_name,
            bytes=len(content),
            text_chars=len(text),
        )
        return {"text": text, "extractor": extractor_name}
