"""Unit tests for Level-3 aggregation over synthetic frame records."""

from __future__ import annotations

import numpy as np
import pytest

from app.analysis.aggregate import (
    aggregate_body,
    aggregate_hands,
    aggregate_interaction,
    aggregate_quality,
    aggregate_speech,
    aggregate_visual,
    aggregate_voice,
)
from app.analysis.audio.disfluency import DisfluencyResult
from app.analysis.audio.fillers import FillerMatch, FillerResult
from app.analysis.audio.pitch_energy import VoiceSeries
from app.analysis.audio.vad import SpeechSegment
from app.analysis.audio.wpm import SegmentWpm, SpeechRateResult
from app.analysis.visual.extractor import FrameVisualRecord


def _record(ts: float, **overrides: object) -> FrameVisualRecord:
    record = FrameVisualRecord(timestamp=ts, blur_score=200.0)
    for key, value in overrides.items():
        setattr(record, key, value)
    return record


def _face_records(count: int = 10) -> list[FrameVisualRecord]:
    return [
        _record(
            i * 0.2,
            face_visible=True,
            gaze_direction="camera" if i % 4 else "left",
            gaze_deviation=0.05 if i % 4 else 0.3,
            head_yaw=float(i),
            head_pitch=1.0,
            head_roll=0.5,
            mouth_opening=0.1 + 0.01 * i,
            eye_openness=0.3,
            eyebrow_position=0.2,
        )
        for i in range(count)
    ]


def test_visual_aggregation_happy_path() -> None:
    features = aggregate_visual(_face_records(), {}, "video")
    assert features.face_visible_ratio.valid and features.face_visible_ratio.value == 1.0
    assert features.camera_gaze_ratio.valid
    assert features.camera_gaze_ratio.value == pytest.approx(0.7)
    assert features.looking_away_ratio.value == pytest.approx(0.3)
    assert features.gaze_deviation_mean.valid
    assert features.head_yaw_mean.valid and features.head_yaw_mean.value == 4.5
    assert features.head_yaw_std.valid
    assert features.head_movement.valid
    assert features.large_head_turn_count.valid
    assert features.mouth_movement.valid
    assert features.facial_activity.valid
    assert features.facial_change_frequency.valid


def test_visual_invalid_for_audio_media() -> None:
    features = aggregate_visual([], {}, "audio")
    assert features.face_visible_ratio.valid is False
    assert features.face_visible_ratio.reason == "no_video_track"
    assert features.camera_gaze_ratio.valid is False


def test_visual_face_never_visible() -> None:
    records = [_record(i * 0.2) for i in range(5)]
    features = aggregate_visual(records, {}, "video")
    # face_visible_ratio is a true measurement: 0.0, valid.
    assert features.face_visible_ratio.valid and features.face_visible_ratio.value == 0.0
    assert features.camera_gaze_ratio.valid is False
    assert features.camera_gaze_ratio.reason == "face_not_visible"
    assert features.head_yaw_mean.valid is False


def test_visual_group_failure_propagates_reason() -> None:
    features = aggregate_visual([], {"face": "face_landmarker_model_missing"}, "video")
    assert features.face_visible_ratio.reason == "face_landmarker_model_missing"


def test_body_aggregation() -> None:
    records = [
        _record(
            i * 0.2,
            pose_detected=True,
            posture_valid=i < 8,
            posture_upright=i % 2 == 0 if i < 8 else None,
            body_lean=float(i) if i < 8 else None,
            upper_body_movement=0.01,
        )
        for i in range(10)
    ]
    features = aggregate_body(records, {}, "video")
    assert features.posture_visibility.value == 1.0
    assert features.posture_valid.value == 0.8
    assert features.upright_ratio.value == 0.5
    assert features.body_lean.value == 3.5
    assert features.posture_stability.valid
    assert features.upper_body_movement.value == 0.01


def test_hands_aggregation() -> None:
    records = [
        _record(
            i * 0.2,
            hands_detected=i >= 5,
            hands_visible=1 if i >= 5 else 0,
            hand_movement=0.05 if 5 <= i < 8 else 0.0,
        )
        for i in range(10)
    ]
    features = aggregate_hands(records, {}, "video")
    assert features.hands_visible_ratio.value == 0.5
    assert features.hand_movement.valid
    assert features.gesture_frequency.valid
    assert features.gesture_duration.valid


def test_speech_aggregation_full() -> None:
    segments = [SpeechSegment(0.0, 4.0), SpeechSegment(6.0, 10.0)]
    rate = SpeechRateResult(
        segment_wpms=[SegmentWpm(0.0, 4.0, 150.0), SegmentWpm(6.0, 10.0, 170.0)],
        fast_segment_count=0,
        slow_segment_count=0,
    )
    fillers = FillerResult(
        matches=[FillerMatch("um", 1.0, 1.2, 1)],
        total_words=40,
    )
    disfluencies = DisfluencyResult(repetition_count=2, repetition_times=[1.0, 2.0])
    features = aggregate_speech(
        segments,
        12.0,
        rate,
        fillers,
        disfluencies,
        vad_available=True,
        transcript_available=True,
    )
    assert features.speaking_time.value == 8.0
    assert features.silence_time.value == 4.0
    assert features.pause_count.value == 1.0
    assert features.pause_duration_mean.value == 2.0
    assert features.pause_duration_max.value == 2.0
    assert features.wpm_mean.value == 160.0
    assert features.filler_count.value == 1.0
    assert features.filler_count.heuristic is True
    assert features.filler_rate.value == 1 / 40
    assert features.fillers_per_minute.value == 7.5
    assert features.repetition_count.value == 2.0
    assert features.repetition_count.heuristic is True


def test_speech_invalid_without_transcript() -> None:
    features = aggregate_speech(
        [SpeechSegment(0.0, 4.0)],
        4.0,
        None,
        None,
        None,
        vad_available=True,
        transcript_available=False,
    )
    assert features.speaking_time.valid  # VAD-derived features still work
    assert features.wpm_mean.valid is False
    assert features.wpm_mean.reason == "transcript_unavailable"
    assert features.filler_count.valid is False


def test_speech_invalid_without_vad() -> None:
    features = aggregate_speech(
        [],
        4.0,
        None,
        None,
        None,
        vad_available=False,
        transcript_available=False,
    )
    assert features.speaking_time.valid is False
    assert features.speaking_time.reason == "vad_unavailable"


def test_voice_aggregation() -> None:
    series = VoiceSeries(
        f0_hz=np.array([100.0, 150.0, 200.0]),
        rms=np.array([0.1, 0.2, 0.3]),
        speech_samples=16000,
    )
    features = aggregate_voice(series)
    assert features.pitch_mean.value == 150.0
    assert features.pitch_range.value == 100.0
    assert features.rms_mean.value == pytest.approx(0.2)


def test_voice_invalid_without_series() -> None:
    features = aggregate_voice(None)
    assert features.pitch_mean.valid is False
    assert features.pitch_mean.reason == "insufficient_speech"


def test_interaction_always_invalid_single_speaker() -> None:
    features = aggregate_interaction()
    for name in type(features).model_fields:
        measurement = getattr(features, name)
        assert measurement.valid is False
        assert measurement.reason == "single_speaker_recording"


def test_quality_aggregation_video() -> None:
    records = [
        _record(i * 0.2, blur_score=10.0 if i == 0 else 200.0, face_visible=True) for i in range(10)
    ]
    features = aggregate_quality(
        records,
        "video",
        duration_sec=2.0,
        analysis_fps=5.0,
        width=854,
        height=480,
        source_fps=30.0,
        audio_samples=np.zeros(100, dtype=np.float32),
    )
    assert features.blur_ratio.value == 0.1
    assert features.frame_drop_ratio.value == 0.0
    assert features.resolution.value == 854 * 480
    assert features.fps.value == 30.0
    assert features.face_visible_ratio.value == 1.0
    assert features.audio_clipped_ratio.value == 0.0


def test_quality_audio_only() -> None:
    features = aggregate_quality(
        [],
        "audio",
        duration_sec=2.0,
        analysis_fps=5.0,
        width=None,
        height=None,
        source_fps=None,
        audio_samples=None,
    )
    assert features.blur_ratio.valid is False
    assert features.blur_ratio.reason == "no_video_track"
    assert features.audio_clipped_ratio.valid is False
    assert features.audio_clipped_ratio.reason == "no_audio_track"
