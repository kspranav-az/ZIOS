"""Real PDF text extraction via pypdf (local library, no third-party SaaS)."""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader

from app.documents.ports import TextExtractorPort


class PypdfExtractor(TextExtractorPort):
    """Extract text from PDF bytes with pypdf.

    Raises ValueError on corrupt or non-PDF input so callers can map the
    failure to a 4xx instead of a generic 502.
    """

    async def extract_text(self, content: bytes, content_type: str) -> str:
        if content_type != "application/pdf":
            raise ValueError(f"PypdfExtractor only handles application/pdf, got {content_type!r}")
        try:
            reader = PdfReader(BytesIO(content))
        except Exception as exc:
            raise ValueError(f"not a parseable PDF: {exc}") from exc
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
        text = "\n".join(page for page in pages if page)
        if not text.strip():
            raise ValueError("PDF contains no extractable text (scanned image?)")
        return text

    async def healthcheck(self) -> dict[str, object]:
        return {"status": "healthy", "adapter": "pypdf"}
