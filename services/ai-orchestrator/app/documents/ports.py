"""Provider port for document text extraction.

Real extractors (pypdf today, OCR/cloud later) implement this same interface.
In mock mode the bytes are ignored and a fixture text is returned so contract
tests stay hermetic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class TextExtractorPort(ABC):
    """Extract plain text from a binary document."""

    @abstractmethod
    async def extract_text(self, content: bytes, content_type: str) -> str:
        """Return the document's plain text.

        Raises ValueError when the bytes cannot be parsed as the declared
        content type.
        """
        raise NotImplementedError

    @abstractmethod
    async def healthcheck(self) -> dict[str, object]:
        """Return adapter health and configuration metadata."""
        raise NotImplementedError
