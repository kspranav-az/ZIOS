"""HTTP transport for the analysis pipeline.

``POST /analysis/video`` (name kept for symmetry with ``/video/transcribe``;
it accepts ``media_kind='audio'`` too). Typed pipeline errors map to their
HTTP status with body ``{"error_code", "error_message"}`` — failures are never
collapsed into a 200 response.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.analysis.config import load_settings
from app.analysis.errors import AnalysisError, InvalidRequestError
from app.analysis.schemas import AnalysisErrorBody, AnalysisRequest
from app.analysis.service import AnalysisService
from app.analysis.visual.models import (
    ALL_MODELS,
    default_model_dir,
    find_model,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/analysis", tags=["analysis"])

_SETTINGS = load_settings()

# Loud boot-time failure on a misconfigured STT adapter selection.
_VALID_ADAPTERS = ("mock", "gcp")
if _SETTINGS.stt_adapter not in _VALID_ADAPTERS:
    raise RuntimeError(
        f"unknown STT_ADAPTER {_SETTINGS.stt_adapter!r}; expected one of: "
        + ", ".join(_VALID_ADAPTERS)
    )

_service: AnalysisService | None = None


def get_service() -> AnalysisService:
    """Process-wide service singleton (STT adapter constructed lazily)."""
    global _service
    if _service is None:
        _service = AnalysisService(settings=_SETTINGS)
    return _service


def _error_response(exc: AnalysisError) -> JSONResponse:
    body = AnalysisErrorBody(error_code=exc.error_code, error_message=exc.message)
    return JSONResponse(status_code=exc.http_status, content=body.model_dump())


@router.post("/video", response_model=None)
async def analyze_video(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        return _error_response(InvalidRequestError("request body must be valid JSON"))
    try:
        analysis_request = AnalysisRequest.model_validate(payload)
    except ValidationError as exc:
        return _error_response(InvalidRequestError(f"invalid request: {exc}"))
    try:
        response = await get_service().analyze(analysis_request)
    except AnalysisError as exc:
        logger.warning(
            "analysis_request_failed",
            analysis_job_id=analysis_request.analysis_job_id,
            session_id=analysis_request.session_id,
            error_code=exc.error_code,
            error=str(exc),
        )
        return _error_response(exc)
    return JSONResponse(status_code=200, content=response.model_dump(mode="json"))


@router.get("/health")
async def analysis_health() -> dict[str, object]:
    model_dir = Path(_SETTINGS.model_dir) if _SETTINGS.model_dir else default_model_dir()
    models = {spec.name: find_model(spec, model_dir) is not None for spec in ALL_MODELS}
    return {
        "status": "ok",
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
        "stt_adapter": _SETTINGS.stt_adapter,
        "model_dir": str(model_dir),
        "models": models,
    }
