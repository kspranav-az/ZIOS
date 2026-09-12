"""Pydantic request/response and feature schemas for the analysis pipeline.

Design invariants (AGENTS.md §2):
- Objective measurements only. No emotion, personality, or truthfulness
  inference anywhere in this schema.
- Every scalar measurement is a ``Measurement``: ``value`` is None and
  ``valid`` is False (with a human-readable ``reason``) when the signal could
  not be measured. We never emit fake zeros.
- Gaze is reported as ``camera_gaze_ratio`` (fraction of face-visible frames
  where the geometric gaze direction is 'camera'). Nothing else.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0.0"


class Measurement(BaseModel):
    """A single scalar measurement with validity metadata."""

    value: float | None = None
    valid: bool = False
    reason: str | None = None
    # True when the number comes from a documented heuristic rather than a
    # direct measurement (fillers, repetitions, false starts, ...).
    heuristic: bool = False


def valid_measurement(value: float, *, heuristic: bool = False) -> Measurement:
    return Measurement(value=value, valid=True, heuristic=heuristic)


def invalid_measurement(reason: str, *, heuristic: bool = False) -> Measurement:
    return Measurement(value=None, valid=False, reason=reason, heuristic=heuristic)


class WindowStats(BaseModel):
    """Statistics for one metric inside one time window."""

    mean: float
    median: float
    std: float
    min: float
    max: float
    count: int


class WindowFeatures(BaseModel):
    """Level-2 aggregation for one ~ANALYSIS_WINDOW_SEC slice of the media."""

    start: float
    end: float
    # Per-metric stats for continuous signals sampled in this window
    # (e.g. "gaze_deviation", "head_yaw", "hand_movement").
    metrics: dict[str, WindowStats] = Field(default_factory=dict)
    # Event counts inside this window (e.g. "filler", "pause", "gesture").
    counts: dict[str, int] = Field(default_factory=dict)


class VisualFeatures(BaseModel):
    """Face/gaze/head/facial-geometry features. Objective geometry only."""

    face_visible_ratio: Measurement = Field(default_factory=Measurement)
    camera_gaze_ratio: Measurement = Field(default_factory=Measurement)
    looking_away_ratio: Measurement = Field(default_factory=Measurement)
    gaze_deviation_mean: Measurement = Field(default_factory=Measurement)
    gaze_variability: Measurement = Field(default_factory=Measurement)
    head_yaw_mean: Measurement = Field(default_factory=Measurement)
    head_yaw_std: Measurement = Field(default_factory=Measurement)
    head_pitch_mean: Measurement = Field(default_factory=Measurement)
    head_pitch_std: Measurement = Field(default_factory=Measurement)
    head_roll_mean: Measurement = Field(default_factory=Measurement)
    head_roll_std: Measurement = Field(default_factory=Measurement)
    head_movement: Measurement = Field(default_factory=Measurement)
    large_head_turn_count: Measurement = Field(default_factory=Measurement)
    facial_activity: Measurement = Field(default_factory=Measurement)
    mouth_movement: Measurement = Field(default_factory=Measurement)
    eyebrow_movement: Measurement = Field(default_factory=Measurement)
    facial_change_frequency: Measurement = Field(default_factory=Measurement)


class BodyFeatures(BaseModel):
    """Upper-body posture features from pose landmarks."""

    posture_visibility: Measurement = Field(default_factory=Measurement)
    upright_ratio: Measurement = Field(default_factory=Measurement)
    body_lean: Measurement = Field(default_factory=Measurement)
    posture_stability: Measurement = Field(default_factory=Measurement)
    upper_body_movement: Measurement = Field(default_factory=Measurement)
    # Fraction of frames where pose landmarks were sufficient to compute
    # posture at all. Low values mean "cannot measure", NOT "poor posture".
    posture_valid: Measurement = Field(default_factory=Measurement)


class HandFeatures(BaseModel):
    """Hand visibility and movement magnitude (no gesture semantics)."""

    hands_visible_ratio: Measurement = Field(default_factory=Measurement)
    hand_movement: Measurement = Field(default_factory=Measurement)
    gesture_frequency: Measurement = Field(default_factory=Measurement)
    gesture_duration: Measurement = Field(default_factory=Measurement)


class SpeechFeatures(BaseModel):
    """Timing/rate/disfluency features derived from VAD + transcript."""

    speaking_time: Measurement = Field(default_factory=Measurement)
    silence_time: Measurement = Field(default_factory=Measurement)
    pause_count: Measurement = Field(default_factory=Measurement)
    pause_duration_mean: Measurement = Field(default_factory=Measurement)
    pause_duration_max: Measurement = Field(default_factory=Measurement)
    wpm_mean: Measurement = Field(default_factory=Measurement)
    wpm_median: Measurement = Field(default_factory=Measurement)
    wpm_std: Measurement = Field(default_factory=Measurement)
    fast_segment_count: Measurement = Field(default_factory=Measurement)
    slow_segment_count: Measurement = Field(default_factory=Measurement)
    filler_count: Measurement = Field(default_factory=Measurement)
    filler_rate: Measurement = Field(default_factory=Measurement)
    fillers_per_minute: Measurement = Field(default_factory=Measurement)
    repetition_count: Measurement = Field(default_factory=Measurement)
    false_start_count: Measurement = Field(default_factory=Measurement)
    self_correction_count: Measurement = Field(default_factory=Measurement)


class VoiceFeatures(BaseModel):
    """Pitch (Hz) and energy (RMS) over speech regions only."""

    pitch_mean: Measurement = Field(default_factory=Measurement)
    pitch_median: Measurement = Field(default_factory=Measurement)
    pitch_std: Measurement = Field(default_factory=Measurement)
    pitch_range: Measurement = Field(default_factory=Measurement)
    rms_mean: Measurement = Field(default_factory=Measurement)
    rms_std: Measurement = Field(default_factory=Measurement)
    rms_range: Measurement = Field(default_factory=Measurement)


class InteractionFeatures(BaseModel):
    """Multi-speaker interaction features.

    Async video/voice answers are single-speaker recordings, so every
    measurement here is present but invalid with reason
    'single_speaker_recording'. The fields exist so live multi-party modes can
    populate them later without a schema change.
    """

    talk_ratio: Measurement = Field(default_factory=Measurement)
    turn_transition_count: Measurement = Field(default_factory=Measurement)
    overlap_time_ratio: Measurement = Field(default_factory=Measurement)
    interruption_count: Measurement = Field(default_factory=Measurement)


class QualityFeatures(BaseModel):
    """Capture-quality indicators (blur, frame drops, resolution, audio)."""

    blur_ratio: Measurement = Field(default_factory=Measurement)
    frame_drop_ratio: Measurement = Field(default_factory=Measurement)
    # Total pixel count (width * height) of the analysed video stream.
    resolution: Measurement = Field(default_factory=Measurement)
    fps: Measurement = Field(default_factory=Measurement)
    face_visible_ratio: Measurement = Field(default_factory=Measurement)
    posture_available_ratio: Measurement = Field(default_factory=Measurement)
    hands_visible_ratio: Measurement = Field(default_factory=Measurement)
    # Fraction of audio samples at/near full scale (clipping indicator).
    audio_clipped_ratio: Measurement = Field(default_factory=Measurement)


class InterviewFeatures(BaseModel):
    """Level-3 aggregate feature set for one interview media object."""

    schema_version: str = SCHEMA_VERSION
    session_id: str
    question_id: str | None = None
    media_kind: Literal["video", "audio"]
    visual: VisualFeatures = Field(default_factory=VisualFeatures)
    body: BodyFeatures = Field(default_factory=BodyFeatures)
    hands: HandFeatures = Field(default_factory=HandFeatures)
    speech: SpeechFeatures = Field(default_factory=SpeechFeatures)
    voice: VoiceFeatures = Field(default_factory=VoiceFeatures)
    interaction: InteractionFeatures = Field(default_factory=InteractionFeatures)
    quality: QualityFeatures = Field(default_factory=QualityFeatures)
    windows: list[WindowFeatures] = Field(default_factory=list)


class MediaMetadata(BaseModel):
    duration_sec: float
    fps: float | None = None
    width: int | None = None
    height: int | None = None
    video_codec: str | None = None
    audio_sample_rate: int | None = None
    audio_channels: int | None = None


class ProcessingMetrics(BaseModel):
    duration_ms: float
    media_duration_sec: float | None = None
    frames_processed: int = 0
    audio_duration_sec: float | None = None
    features_generated: int = 0


class AnalysisRequest(BaseModel):
    analysis_job_id: str
    session_id: str
    question_id: str | None = None
    object_name: str
    media_kind: Literal["video", "audio"]
    include_transcript: bool = True
    language_hint: str | None = None
    # The API is the consent gatekeeper (PRD X8); this flag is defence in
    # depth. Requests without verified consent are rejected with
    # INVALID_REQUEST before any media is touched.
    consent_verified: bool


class AnalysisResultRef(BaseModel):
    object_prefix: str
    objects: dict[str, str]


class AnalysisResponse(BaseModel):
    status: Literal["completed"] = "completed"
    analysis_job_id: str
    schema_version: str = SCHEMA_VERSION
    result: AnalysisResultRef
    transcript_text: str | None = None
    features: InterviewFeatures
    media: MediaMetadata
    metrics: ProcessingMetrics


class AnalysisErrorBody(BaseModel):
    error_code: str
    error_message: str
