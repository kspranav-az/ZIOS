"""FastAPI routes for document text extraction."""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.documents.service import DocumentExtractionService

router = APIRouter(prefix="/documents", tags=["documents"])
logger = structlog.get_logger()


class ExtractTextRequest(BaseModel):
    content_base64: str = Field(min_length=1)
    content_type: str = Field(min_length=1)


@router.post("/extract-text")
async def extract_text(body: ExtractTextRequest) -> dict[str, str]:
    """Extract plain text from base64 document bytes.

    text/plain decodes directly; application/pdf routes through the
    configured TextExtractorPort (pypdf or mock).
    """
    service = DocumentExtractionService()
    try:
        result = await service.extract_text(body.content_base64, body.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@router.get("/health/extraction")
async def extraction_healthcheck() -> dict[str, Any]:
    """Health check for the document extraction pipeline."""
    service = DocumentExtractionService()
    return {
        "status": "healthy",
        "extractor": await service.extractor.healthcheck(),
    }
