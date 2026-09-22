"""Environment-driven configuration for the multimodal analysis pipeline.

All settings are plain process env vars with conservative defaults so the
service boots in mock mode with zero configuration (per AGENTS.md §3, real
providers are opt-in).
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field

DEFAULT_FILLER_WORDS = "um,uh,erm,like,you know,actually,basically,sort of"

DEFAULT_FAST_WPM = 180.0
DEFAULT_SLOW_WPM = 100.0


@dataclass(frozen=True)
class AnalysisSettings:
    """Immutable snapshot of analysis-pipeline configuration."""

    stt_adapter: str = "mock"
    gcp_project_id: str | None = None
    gcp_location: str = "global"
    # Optional JSON blob with provider-specific recognition options
    # (e.g. {"model": "chirp_2", "language_codes": ["en-IN"]}).
    gcp_stt_config: dict[str, object] | None = None
    video_analysis_fps: float = 5.0
    video_analysis_width: int = 854
    vad_threshold: float = 0.5
    analysis_window_sec: float = 10.0
    filler_words: tuple[str, ...] = field(
        default_factory=lambda: tuple(w.strip() for w in DEFAULT_FILLER_WORDS.split(","))
    )
    # None means "use the system temp dir".
    analysis_temp_dir: str | None = None
    fast_wpm_threshold: float = DEFAULT_FAST_WPM
    slow_wpm_threshold: float = DEFAULT_SLOW_WPM
    # Directory holding MediaPipe .task files and the Silero VAD onnx model.
    # In the Docker image this is /opt/mediapipe-models; locally it falls back
    # to a per-user cache (see app.analysis.visual.models.ensure_models).
    model_dir: str | None = None


def _parse_filler_words(raw: str) -> tuple[str, ...]:
    words = tuple(w.strip().lower() for w in raw.split(",") if w.strip())
    return words or tuple(w.strip() for w in DEFAULT_FILLER_WORDS.split(","))


def load_settings(env: dict[str, str] | None = None) -> AnalysisSettings:
    """Build settings from the process environment (or an explicit mapping)."""
    source = os.environ if env is None else env

    gcp_stt_config: dict[str, object] | None = None
    raw_gcp_config = source.get("GCP_STT_CONFIG", "").strip()
    if raw_gcp_config:
        parsed = json.loads(raw_gcp_config)
        if not isinstance(parsed, dict):
            raise ValueError("GCP_STT_CONFIG must be a JSON object")
        gcp_stt_config = parsed

    temp_dir = source.get("ANALYSIS_TEMP_DIR", "").strip() or None
    if temp_dir is None:
        temp_dir = tempfile.gettempdir()

    return AnalysisSettings(
        stt_adapter=source.get("STT_ADAPTER", "mock").strip().lower() or "mock",
        gcp_project_id=source.get("GCP_PROJECT_ID", "").strip() or None,
        gcp_location=source.get("GCP_LOCATION", "global").strip() or "global",
        gcp_stt_config=gcp_stt_config,
        video_analysis_fps=float(source.get("VIDEO_ANALYSIS_FPS", "5")),
        video_analysis_width=int(source.get("VIDEO_ANALYSIS_WIDTH", "854")),
        vad_threshold=float(source.get("VAD_THRESHOLD", "0.5")),
        analysis_window_sec=float(source.get("ANALYSIS_WINDOW_SEC", "10")),
        filler_words=_parse_filler_words(source.get("FILLER_WORDS", DEFAULT_FILLER_WORDS)),
        analysis_temp_dir=temp_dir,
        fast_wpm_threshold=float(source.get("FAST_WPM_THRESHOLD", str(DEFAULT_FAST_WPM))),
        slow_wpm_threshold=float(source.get("SLOW_WPM_THRESHOLD", str(DEFAULT_SLOW_WPM))),
        model_dir=source.get("ANALYSIS_MODEL_DIR", "").strip() or None,
    )
