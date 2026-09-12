"""Typed errors for the analysis pipeline.

Every failure carries a stable ``error_code`` and an HTTP status. The router
maps these to a JSON body ``{"error_code", "error_message"}`` — analysis
failures are NEVER collapsed into a fake-success 200 response.
"""

from __future__ import annotations


class AnalysisError(Exception):
    """Base class for all analysis-pipeline failures."""

    error_code: str = "ANALYSIS_FAILED"
    http_status: int = 500

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class InvalidRequestError(AnalysisError):
    error_code = "INVALID_REQUEST"
    http_status = 400


class ObjectNotFoundError(AnalysisError):
    error_code = "OBJECT_NOT_FOUND"
    http_status = 404


class CorruptMediaError(AnalysisError):
    error_code = "CORRUPT_MEDIA"
    http_status = 422


class FfmpegError(AnalysisError):
    error_code = "FFMPEG_FAILED"
    http_status = 500


class SttError(AnalysisError):
    error_code = "STT_FAILED"
    http_status = 502


class MediaPipeError(AnalysisError):
    error_code = "MEDIAPIPE_FAILED"
    http_status = 500
