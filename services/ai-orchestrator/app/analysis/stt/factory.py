"""STT adapter factory for the analysis pipeline.

Selects the concrete ``SttPort`` implementation from ``STT_ADAPTER``. Unknown
values are a loud boot-time error — silently falling back to a mock in
production would fabricate transcripts.
"""

from __future__ import annotations

import structlog

from app.analysis.config import AnalysisSettings
from app.voice.mock_stt import MockSttAdapter
from app.voice.ports import SttPort

logger = structlog.get_logger()


def build_stt_adapter(settings: AnalysisSettings) -> SttPort:
    if settings.stt_adapter == "mock":
        logger.info("stt_adapter_selected", adapter="mock")
        return MockSttAdapter()
    if settings.stt_adapter == "gcp":
        from app.analysis.stt.gcp import GoogleCloudSttAdapter

        logger.info(
            "stt_adapter_selected",
            adapter="gcp",
            project_id=settings.gcp_project_id,
            location=settings.gcp_location,
        )
        return GoogleCloudSttAdapter(
            project_id=settings.gcp_project_id,
            location=settings.gcp_location,
            config=settings.gcp_stt_config,
        )
    raise ValueError(f"unknown STT_ADAPTER {settings.stt_adapter!r}; expected one of: mock, gcp")
