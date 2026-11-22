"""STT adapter factory for the analysis pipeline.

Selects the concrete ``SttPort`` implementation from ``STT_ADAPTER``. gcp is
the default real transcription (Google Cloud Speech v2); mock is the scripted
fixture for tests/CI. gcp without configuration (missing project id or
credentials) degrades to mock with a loud warning so keyless environments
still boot — never silently. Unknown values are a loud boot-time error.
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
        try:
            from app.analysis.stt.gcp import GoogleCloudSttAdapter

            adapter = GoogleCloudSttAdapter(
                project_id=settings.gcp_project_id,
                location=settings.gcp_location,
                config=settings.gcp_stt_config,
            )
        except Exception as exc:
            # GCP is the default: a keyless environment (CI, fresh clone)
            # must still boot — loudly, not silently.
            logger.warning("stt_gcp_unavailable_falling_back_to_mock", error=str(exc))
            return MockSttAdapter()
        logger.info(
            "stt_adapter_selected",
            adapter="gcp",
            project_id=settings.gcp_project_id,
            location=settings.gcp_location,
        )
        return adapter
    raise ValueError(f"unknown STT_ADAPTER {settings.stt_adapter!r}; expected one of: mock, gcp")
