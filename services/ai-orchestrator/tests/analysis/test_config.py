"""Unit tests for analysis config parsing and error taxonomy."""

from __future__ import annotations

import pytest

from app.analysis.config import DEFAULT_FILLER_WORDS, load_settings
from app.analysis.errors import (
    AnalysisError,
    CorruptMediaError,
    FfmpegError,
    InvalidRequestError,
    MediaPipeError,
    ObjectNotFoundError,
    SttError,
)


def test_defaults_are_mock_and_safe() -> None:
    settings = load_settings({})
    assert settings.stt_adapter == "mock"
    assert settings.gcp_project_id is None
    assert settings.gcp_location == "global"
    assert settings.video_analysis_fps == 5.0
    assert settings.video_analysis_width == 854
    assert settings.vad_threshold == 0.5
    assert settings.analysis_window_sec == 10.0
    assert settings.filler_words == tuple(w.strip() for w in DEFAULT_FILLER_WORDS.split(","))
    assert settings.analysis_temp_dir is not None


def test_env_overrides() -> None:
    settings = load_settings(
        {
            "STT_ADAPTER": "gcp",
            "GCP_PROJECT_ID": "proj-1",
            "GCP_LOCATION": "us",
            "GCP_STT_CONFIG": '{"model": "chirp_2", "language_codes": ["en-IN"]}',
            "VIDEO_ANALYSIS_FPS": "3",
            "VIDEO_ANALYSIS_WIDTH": "640",
            "VAD_THRESHOLD": "0.7",
            "ANALYSIS_WINDOW_SEC": "15",
            "FILLER_WORDS": "um, kind of , stuff",
            "ANALYSIS_TEMP_DIR": "/tmp/x",
        }
    )
    assert settings.stt_adapter == "gcp"
    assert settings.gcp_project_id == "proj-1"
    assert settings.gcp_location == "us"
    assert settings.gcp_stt_config == {"model": "chirp_2", "language_codes": ["en-IN"]}
    assert settings.video_analysis_fps == 3.0
    assert settings.video_analysis_width == 640
    assert settings.vad_threshold == 0.7
    assert settings.analysis_window_sec == 15.0
    assert settings.filler_words == ("um", "kind of", "stuff")
    assert settings.analysis_temp_dir == "/tmp/x"


def test_gcp_stt_config_must_be_object() -> None:
    with pytest.raises(ValueError, match="GCP_STT_CONFIG"):
        load_settings({"GCP_STT_CONFIG": '["not", "an", "object"]'})


def test_error_taxonomy_maps_to_http_status() -> None:
    cases: list[tuple[type[AnalysisError], str, int]] = [
        (InvalidRequestError, "INVALID_REQUEST", 400),
        (ObjectNotFoundError, "OBJECT_NOT_FOUND", 404),
        (CorruptMediaError, "CORRUPT_MEDIA", 422),
        (FfmpegError, "FFMPEG_FAILED", 500),
        (SttError, "STT_FAILED", 502),
        (MediaPipeError, "MEDIAPIPE_FAILED", 500),
    ]
    for exc_type, code, status in cases:
        exc = exc_type("boom")
        assert exc.error_code == code
        assert exc.http_status == status
        assert exc.message == "boom"
