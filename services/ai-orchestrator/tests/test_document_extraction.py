"""Tests for document text extraction (Phase 12b: pypdf + mock extractors)."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.documents.mock_extractor import FIXTURE_TEXT, MockTextExtractor
from app.documents.pypdf_extractor import PypdfExtractor
from app.documents.service import DocumentExtractionService
from app.main import app

FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


class TestMockExtractor:
    async def test_returns_fixture_for_any_bytes(self) -> None:
        extractor = MockTextExtractor()
        text = await extractor.extract_text(b"not really a pdf", "application/pdf")
        assert text == FIXTURE_TEXT
        assert "Priya Sharma" in text

    async def test_healthcheck(self) -> None:
        health = await MockTextExtractor().healthcheck()
        assert health["adapter"] == "mock"


class TestPypdfExtractor:
    async def test_extracts_text_from_real_pdf(self) -> None:
        pdf_bytes = (FIXTURE_DIR / "tiny-resume.pdf").read_bytes()
        extractor = PypdfExtractor()
        text = await extractor.extract_text(pdf_bytes, "application/pdf")
        assert "Priya Sharma" in text
        assert "Backend engineer" in text

    async def test_rejects_corrupt_bytes(self) -> None:
        extractor = PypdfExtractor()
        with pytest.raises(ValueError, match="not a parseable PDF"):
            await extractor.extract_text(b"definitely not a pdf", "application/pdf")

    async def test_rejects_wrong_content_type(self) -> None:
        extractor = PypdfExtractor()
        with pytest.raises(ValueError, match="only handles application/pdf"):
            await extractor.extract_text(b"hello", "text/plain")


class TestDocumentExtractionService:
    async def test_text_plain_decodes_directly(self) -> None:
        service = DocumentExtractionService(extractor=MockTextExtractor())
        result = await service.extract_text(_b64(b"Hello resume"), "text/plain")
        assert result == {"text": "Hello resume", "extractor": "plain"}

    async def test_pdf_routes_through_extractor(self) -> None:
        pdf_bytes = (FIXTURE_DIR / "tiny-resume.pdf").read_bytes()
        service = DocumentExtractionService(extractor=PypdfExtractor())
        result = await service.extract_text(_b64(pdf_bytes), "application/pdf")
        assert result["extractor"] == "PypdfExtractor"
        assert "Priya Sharma" in result["text"]

    async def test_unsupported_content_type_raises(self) -> None:
        service = DocumentExtractionService(extractor=MockTextExtractor())
        with pytest.raises(ValueError, match="unsupported content_type"):
            await service.extract_text(_b64(b"x"), "image/png")

    async def test_invalid_base64_raises(self) -> None:
        service = DocumentExtractionService(extractor=MockTextExtractor())
        with pytest.raises(ValueError, match="not valid base64"):
            await service.extract_text("!!!not-base64!!!", "text/plain")

    async def test_empty_content_raises(self) -> None:
        service = DocumentExtractionService(extractor=MockTextExtractor())
        with pytest.raises(ValueError, match="zero bytes"):
            await service.extract_text(_b64(b""), "text/plain")


class TestExtractTextRoute:
    async def test_extract_text_endpoint_with_mock(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DOCUMENT_EXTRACTION_ADAPTER", "mock")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/documents/extract-text",
                json={"content_base64": _b64(b"anything"), "content_type": "application/pdf"},
            )
        assert response.status_code == 200
        body = response.json()
        assert body["extractor"] == "MockTextExtractor"
        assert "Priya Sharma" in body["text"]

    async def test_extract_text_endpoint_422_on_corrupt_pdf(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DOCUMENT_EXTRACTION_ADAPTER", "pypdf")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/documents/extract-text",
                json={"content_base64": _b64(b"garbage"), "content_type": "application/pdf"},
            )
        assert response.status_code == 422

    async def test_extract_text_endpoint_422_on_unsupported_type(self) -> None:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/documents/extract-text",
                json={"content_base64": _b64(b"x"), "content_type": "image/png"},
            )
        assert response.status_code == 422

    async def test_health_endpoint(self) -> None:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/documents/health/extraction")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
