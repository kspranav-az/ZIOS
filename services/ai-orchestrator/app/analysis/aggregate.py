"""Level-3 aggregation: per-frame/per-segment series -> InterviewFeatures.

Pure functions over plain records — no MediaPipe, fully unit-testable with
synthetic data. Rules enforced here:

- Empty/insufficient series produce ``valid=False`` with a reason, never a
  fabricated zero.
- ``media_kind='audio'`` invalidates the visual/body/hands groups with
  ``reason='no_video_track'``.
- Interaction features are always ``valid=False`` with
  ``reason='single_speaker_recording'`` for async single-speaker media.
"""

from __future__ import annotations

import statistics
from itertools import pairwise
from typing import Literal

import numpy as np
import numpy.typing as npt

from app.analysis.align import WindowAccumulator
from app.analysis.audio.disfluency import DisfluencyResult
from app.analysis.audio.fillers import FillerResult
from app.analysis.audio.pitch_energy import VoiceSeries, summarize_pitch, summarize_rms
from app.analysis.audio.vad import SpeechSegment, clipped_ratio, pauses_from_segments
from app.analysis.audio.wpm import SpeechRateResult
from app.analysis.schemas import (
    BodyFeatures,
    HandFeatures,
    InteractionFeatures,
    InterviewFeatures,
    Measurement,
    QualityFeatures,
    SpeechFeatures,
    VisualFeatures,
    VoiceFeatures,
    WindowFeatures,
    invalid_measurement,
    valid_measurement,
)
from app.analysis.visual.extractor import GROUP_FACE, GROUP_HANDS, GROUP_POSE, FrameVisualRecord
from app.analysis.visual.geometry import count_large_head_turns, movement_bursts

# Laplacian-variance threshold below which a frame counts as blurred.
BLUR_THRESHOLD = 60.0
# Normalized-coordinate displacement per frame that marks a hand gesture burst.
HAND_MOVEMENT_BURST_THRESHOLD = 0.02
# Combined facial-delta magnitude that marks a "facial change" frame.
FACIAL_CHANGE_THRESHOLD = 0.05


def _mean_m(values: list[float], reason: str) -> Measurement:
    if not values:
        return invalid_measurement(reason)
    return valid_measurement(statistics.fmean(values))


def _std_m(values: list[float], reason: str) -> Measurement:
    if len(values) < 2:
        return invalid_measurement(reason)
    return valid_measurement(statistics.pstdev(values))


def _median_m(values: list[float], reason: str) -> Measurement:
    if not values:
        return invalid_measurement(reason)
    return valid_measurement(statistics.median(values))


def _ratio_m(flags: list[bool], reason: str) -> Measurement:
    if not flags:
        return invalid_measurement(reason)
    return valid_measurement(sum(flags) / len(flags))


def _count_m(count: int, reason: str, *, available: bool, heuristic: bool = False) -> Measurement:
    if not available:
        return invalid_measurement(reason, heuristic=heuristic)
    return valid_measurement(float(count), heuristic=heuristic)


def _consecutive_deltas(pairs: list[tuple[float, float]]) -> list[float]:
    """Absolute deltas between consecutive samples given (timestamp, value)."""
    return [abs(b[1] - a[1]) for a, b in pairwise(pairs)]


def aggregate_visual(
    records: list[FrameVisualRecord],
    group_failures: dict[str, str],
    media_kind: str,
) -> VisualFeatures:
    features = VisualFeatures()
    if media_kind == "audio":
        return _invalidate_visual(features, "no_video_track")
    failure = group_failures.get(GROUP_FACE)
    if failure is not None:
        return _invalidate_visual(features, failure)
    if not records:
        return _invalidate_visual(features, "no_frames")

    features.face_visible_ratio = _ratio_m([r.face_visible for r in records], "no_frames")

    face_records = [r for r in records if r.face_visible]
    if not face_records:
        gaze_reason = "face_not_visible"
        for field_name in (
            "camera_gaze_ratio",
            "looking_away_ratio",
            "gaze_deviation_mean",
            "gaze_variability",
            "head_yaw_mean",
            "head_yaw_std",
            "head_pitch_mean",
            "head_pitch_std",
            "head_roll_mean",
            "head_roll_std",
            "head_movement",
            "large_head_turn_count",
            "facial_activity",
            "mouth_movement",
            "eyebrow_movement",
            "facial_change_frequency",
        ):
            setattr(features, field_name, invalid_measurement(gaze_reason))
        return features

    directions = [r.gaze_direction for r in face_records if r.gaze_direction is not None]
    features.camera_gaze_ratio = _ratio_m(
        [d == "camera" for d in directions], "gaze_not_measurable"
    )
    features.looking_away_ratio = _ratio_m(
        [d != "camera" for d in directions], "gaze_not_measurable"
    )

    deviations = [r.gaze_deviation for r in face_records if r.gaze_deviation is not None]
    features.gaze_deviation_mean = _mean_m(deviations, "gaze_not_measurable")
    features.gaze_variability = _std_m(deviations, "gaze_not_measurable")

    yaws = [r.head_yaw for r in face_records if r.head_yaw is not None]
    pitches = [r.head_pitch for r in face_records if r.head_pitch is not None]
    rolls = [r.head_roll for r in face_records if r.head_roll is not None]
    features.head_yaw_mean = _mean_m(yaws, "head_pose_not_measurable")
    features.head_yaw_std = _std_m(yaws, "head_pose_not_measurable")
    features.head_pitch_mean = _mean_m(pitches, "head_pose_not_measurable")
    features.head_pitch_std = _std_m(pitches, "head_pose_not_measurable")
    features.head_roll_mean = _mean_m(rolls, "head_pose_not_measurable")
    features.head_roll_std = _std_m(rolls, "head_pose_not_measurable")

    pose_series = [
        (r.timestamp, (r.head_yaw, r.head_pitch, r.head_roll))
        for r in face_records
        if r.head_yaw is not None and r.head_pitch is not None and r.head_roll is not None
    ]
    angular_deltas = [
        (by - ay) ** 2 + (bp - ap) ** 2 + (br - ar) ** 2
        for (_, (ay, ap, ar)), (_, (by, bp, br)) in pairwise(pose_series)
    ]
    features.head_movement = _mean_m([d**0.5 for d in angular_deltas], "head_pose_not_measurable")
    features.large_head_turn_count = _count_m(
        count_large_head_turns(yaws), "head_pose_not_measurable", available=bool(yaws)
    )

    mouth_series = [
        (r.timestamp, r.mouth_opening) for r in face_records if r.mouth_opening is not None
    ]
    brow_series = [
        (r.timestamp, r.eyebrow_position) for r in face_records if r.eyebrow_position is not None
    ]
    eye_series = [(r.timestamp, r.eye_openness) for r in face_records if r.eye_openness is not None]
    mouth_deltas = _consecutive_deltas(mouth_series)
    brow_deltas = _consecutive_deltas(brow_series)
    eye_deltas = _consecutive_deltas(eye_series)
    features.mouth_movement = _mean_m(mouth_deltas, "facial_geometry_not_measurable")
    features.eyebrow_movement = _mean_m(brow_deltas, "facial_geometry_not_measurable")
    combined = mouth_deltas + brow_deltas + eye_deltas
    features.facial_activity = _mean_m(combined, "facial_geometry_not_measurable")
    duration = face_records[-1].timestamp - face_records[0].timestamp
    if combined and duration > 0:
        changes = sum(1 for d in combined if d >= FACIAL_CHANGE_THRESHOLD)
        features.facial_change_frequency = valid_measurement(changes / duration)
    else:
        features.facial_change_frequency = invalid_measurement("facial_geometry_not_measurable")
    return features


def _invalidate_visual(features: VisualFeatures, reason: str) -> VisualFeatures:
    for field_name in VisualFeatures.model_fields:
        setattr(features, field_name, invalid_measurement(reason))
    return features


def aggregate_body(
    records: list[FrameVisualRecord],
    group_failures: dict[str, str],
    media_kind: str,
) -> BodyFeatures:
    features = BodyFeatures()
    reason: str | None = None
    if media_kind == "audio":
        reason = "no_video_track"
    elif not records:
        reason = "no_frames"
    elif GROUP_POSE in group_failures:
        reason = group_failures[GROUP_POSE]
    if reason is not None:
        for field_name in BodyFeatures.model_fields:
            setattr(features, field_name, invalid_measurement(reason))
        return features

    features.posture_visibility = _ratio_m([r.pose_detected for r in records], "no_frames")
    features.posture_valid = _ratio_m([r.posture_valid for r in records], "no_frames")

    valid_records = [r for r in records if r.posture_valid]
    upright_flags = [
        bool(r.posture_upright) for r in valid_records if r.posture_upright is not None
    ]
    features.upright_ratio = _ratio_m(upright_flags, "posture_not_measurable")
    leans = [r.body_lean for r in valid_records if r.body_lean is not None]
    features.body_lean = _mean_m(leans, "posture_not_measurable")
    # Stability as an inverse dispersion: 1.0 = perfectly still, decaying
    # towards 0 as lean variance grows. Deterministic transform of lean std.
    if len(leans) >= 2:
        features.posture_stability = valid_measurement(1.0 / (1.0 + statistics.pstdev(leans)))
    else:
        features.posture_stability = invalid_measurement("posture_not_measurable")
    movements = [r.upper_body_movement for r in records if r.upper_body_movement is not None]
    features.upper_body_movement = _mean_m(movements, "posture_not_measurable")
    return features


def aggregate_hands(
    records: list[FrameVisualRecord],
    group_failures: dict[str, str],
    media_kind: str,
) -> HandFeatures:
    features = HandFeatures()
    reason: str | None = None
    if media_kind == "audio":
        reason = "no_video_track"
    elif not records:
        reason = "no_frames"
    elif GROUP_HANDS in group_failures:
        reason = group_failures[GROUP_HANDS]
    if reason is not None:
        for field_name in HandFeatures.model_fields:
            setattr(features, field_name, invalid_measurement(reason))
        return features

    features.hands_visible_ratio = _ratio_m([r.hands_detected for r in records], "no_frames")
    movements = [(r.timestamp, r.hand_movement) for r in records if r.hand_movement is not None]
    features.hand_movement = _mean_m([m for _, m in movements], "hands_not_visible")

    bursts = movement_bursts([m for _, m in movements], threshold=HAND_MOVEMENT_BURST_THRESHOLD)
    duration = records[-1].timestamp - records[0].timestamp
    if not movements or duration <= 0:
        features.gesture_frequency = invalid_measurement("hands_not_visible")
        features.gesture_duration = invalid_measurement("hands_not_visible")
    else:
        features.gesture_frequency = valid_measurement(len(bursts) / duration)
        if bursts:
            # Burst durations in seconds via the median inter-sample spacing.
            spacings = [b[1] - a[1] for a, b in pairwise(movements)]
            spacing = statistics.median(spacings) if spacings else 0.0
            lengths = [(end - start + 1) * spacing for start, end in bursts]
            features.gesture_duration = valid_measurement(statistics.fmean(lengths))
        else:
            features.gesture_duration = valid_measurement(0.0)
    return features


def aggregate_speech(
    speech_segments: list[SpeechSegment],
    duration_sec: float,
    rate: SpeechRateResult | None,
    fillers: FillerResult | None,
    disfluencies: DisfluencyResult | None,
    vad_available: bool,
    transcript_available: bool,
) -> SpeechFeatures:
    features = SpeechFeatures()
    if not vad_available:
        features.speaking_time = invalid_measurement("vad_unavailable")
        features.silence_time = invalid_measurement("vad_unavailable")
        features.pause_count = invalid_measurement("vad_unavailable")
        features.pause_duration_mean = invalid_measurement("vad_unavailable")
        features.pause_duration_max = invalid_measurement("vad_unavailable")
    else:
        speaking = sum(s.end - s.start for s in speech_segments)
        features.speaking_time = valid_measurement(speaking)
        features.silence_time = valid_measurement(max(0.0, duration_sec - speaking))
        pauses = pauses_from_segments(speech_segments)
        durations = [p.end - p.start for p in pauses]
        features.pause_count = valid_measurement(float(len(pauses)))
        features.pause_duration_mean = _mean_m(durations, "no_pauses_detected")
        features.pause_duration_max = (
            valid_measurement(max(durations))
            if durations
            else invalid_measurement("no_pauses_detected")
        )

    if not transcript_available:
        reason = "transcript_unavailable"
    elif rate is None or not rate.segment_wpms:
        reason = "insufficient_speech"
    else:
        reason = None
    if reason is not None:
        for field_name in (
            "wpm_mean",
            "wpm_median",
            "wpm_std",
            "fast_segment_count",
            "slow_segment_count",
        ):
            setattr(features, field_name, invalid_measurement(reason))
    else:
        assert rate is not None
        wpms = [s.wpm for s in rate.segment_wpms]
        features.wpm_mean = _mean_m(wpms, "insufficient_speech")
        features.wpm_median = _median_m(wpms, "insufficient_speech")
        features.wpm_std = _std_m(wpms, "insufficient_speech")
        features.fast_segment_count = valid_measurement(float(rate.fast_segment_count))
        features.slow_segment_count = valid_measurement(float(rate.slow_segment_count))

    if fillers is None:
        for field_name in ("filler_count", "filler_rate", "fillers_per_minute"):
            setattr(
                features,
                field_name,
                invalid_measurement("transcript_unavailable", heuristic=True),
            )
    else:
        count = len(fillers.matches)
        features.filler_count = valid_measurement(float(count), heuristic=True)
        features.filler_rate = (
            valid_measurement(count / fillers.total_words, heuristic=True)
            if fillers.total_words > 0
            else invalid_measurement("no_words", heuristic=True)
        )
        if vad_available:
            speaking = sum(s.end - s.start for s in speech_segments)
            features.fillers_per_minute = (
                valid_measurement(count / (speaking / 60.0), heuristic=True)
                if speaking > 0
                else invalid_measurement("insufficient_speech", heuristic=True)
            )
        else:
            features.fillers_per_minute = invalid_measurement("vad_unavailable", heuristic=True)

    if disfluencies is None:
        for field_name in ("repetition_count", "false_start_count", "self_correction_count"):
            setattr(
                features,
                field_name,
                invalid_measurement("transcript_unavailable", heuristic=True),
            )
    else:
        features.repetition_count = valid_measurement(
            float(disfluencies.repetition_count), heuristic=True
        )
        features.false_start_count = valid_measurement(
            float(disfluencies.false_start_count), heuristic=True
        )
        features.self_correction_count = valid_measurement(
            float(disfluencies.self_correction_count), heuristic=True
        )
    return features


def aggregate_voice(series: VoiceSeries | None) -> VoiceFeatures:
    features = VoiceFeatures()
    if series is None:
        for field_name in VoiceFeatures.model_fields:
            setattr(features, field_name, invalid_measurement("insufficient_speech"))
        return features
    pitch = summarize_pitch(series.f0_hz)
    if pitch is None:
        for field_name in ("pitch_mean", "pitch_median", "pitch_std", "pitch_range"):
            setattr(features, field_name, invalid_measurement("no_voiced_frames"))
    else:
        mean, median, std, pitch_range = pitch
        features.pitch_mean = valid_measurement(mean)
        features.pitch_median = valid_measurement(median)
        features.pitch_std = valid_measurement(std)
        features.pitch_range = valid_measurement(pitch_range)
    rms = summarize_rms(series.rms)
    if rms is None:
        for field_name in ("rms_mean", "rms_std", "rms_range"):
            setattr(features, field_name, invalid_measurement("insufficient_speech"))
    else:
        mean, std, rms_range = rms
        features.rms_mean = valid_measurement(mean)
        features.rms_std = valid_measurement(std)
        features.rms_range = valid_measurement(rms_range)
    return features


def aggregate_interaction() -> InteractionFeatures:
    """Single-speaker async media: every measurement present but invalid."""
    features = InteractionFeatures()
    for field_name in InteractionFeatures.model_fields:
        setattr(features, field_name, invalid_measurement("single_speaker_recording"))
    return features


def aggregate_quality(
    records: list[FrameVisualRecord],
    media_kind: str,
    duration_sec: float,
    analysis_fps: float,
    width: int | None,
    height: int | None,
    source_fps: float | None,
    audio_samples: npt.NDArray[np.float32] | None,
) -> QualityFeatures:
    features = QualityFeatures()
    if media_kind == "video" and records:
        features.blur_ratio = _ratio_m(
            [r.blur_score < BLUR_THRESHOLD for r in records], "no_frames"
        )
        expected = duration_sec * analysis_fps
        features.frame_drop_ratio = (
            valid_measurement(max(0.0, min(1.0, 1.0 - len(records) / expected)))
            if expected > 0
            else invalid_measurement("no_frames")
        )
        if width and height:
            features.resolution = valid_measurement(float(width * height))
        else:
            features.resolution = invalid_measurement("no_video_metadata")
        features.fps = (
            valid_measurement(source_fps)
            if source_fps is not None
            else invalid_measurement("no_video_metadata")
        )
        features.face_visible_ratio = _ratio_m([r.face_visible for r in records], "no_frames")
        features.posture_available_ratio = _ratio_m([r.pose_detected for r in records], "no_frames")
        features.hands_visible_ratio = _ratio_m([r.hands_detected for r in records], "no_frames")
    else:
        reason = "no_video_track" if media_kind == "audio" else "no_frames"
        for field_name in (
            "blur_ratio",
            "frame_drop_ratio",
            "resolution",
            "fps",
            "face_visible_ratio",
            "posture_available_ratio",
            "hands_visible_ratio",
        ):
            setattr(features, field_name, invalid_measurement(reason))

    samples = audio_samples
    ratio = clipped_ratio(samples) if samples is not None and samples.size else None
    features.audio_clipped_ratio = (
        valid_measurement(ratio) if ratio is not None else invalid_measurement("no_audio_track")
    )
    return features


def build_windows_features(
    records: list[FrameVisualRecord],
    duration_sec: float,
    window_sec: float,
    events: dict[str, list[float]],
) -> list[WindowFeatures]:
    """Level-2 windows: continuous per-frame metrics + discrete event counts."""
    accumulator = WindowAccumulator(duration_sec, window_sec)
    for record in records:
        points: list[tuple[str, float | None]] = [
            ("gaze_deviation", record.gaze_deviation),
            ("head_yaw", record.head_yaw),
            ("head_pitch", record.head_pitch),
            ("head_roll", record.head_roll),
            ("mouth_opening", record.mouth_opening),
            ("eye_openness", record.eye_openness),
            ("eyebrow_position", record.eyebrow_position),
            ("body_lean", record.body_lean),
            ("upper_body_movement", record.upper_body_movement),
            ("hand_movement", record.hand_movement),
            ("blur_score", record.blur_score),
        ]
        for name, value in points:
            if value is not None:
                accumulator.add_point(name, record.timestamp, value)
    for name, times in events.items():
        for t in times:
            accumulator.add_event(name, t)
    return list(accumulator.build())


def build_interview_features(
    *,
    session_id: str,
    question_id: str | None,
    media_kind: Literal["video", "audio"],
    records: list[FrameVisualRecord],
    group_failures: dict[str, str],
    speech_segments: list[SpeechSegment],
    duration_sec: float,
    analysis_fps: float,
    window_sec: float,
    width: int | None,
    height: int | None,
    source_fps: float | None,
    rate: SpeechRateResult | None,
    fillers: FillerResult | None,
    disfluencies: DisfluencyResult | None,
    voice_series: VoiceSeries | None,
    vad_available: bool,
    transcript_available: bool,
    audio_samples: npt.NDArray[np.float32] | None,
    events: dict[str, list[float]],
) -> InterviewFeatures:
    return InterviewFeatures(
        session_id=session_id,
        question_id=question_id,
        media_kind=media_kind,
        visual=aggregate_visual(records, group_failures, media_kind),
        body=aggregate_body(records, group_failures, media_kind),
        hands=aggregate_hands(records, group_failures, media_kind),
        speech=aggregate_speech(
            speech_segments,
            duration_sec,
            rate,
            fillers,
            disfluencies,
            vad_available,
            transcript_available,
        ),
        voice=aggregate_voice(voice_series),
        interaction=aggregate_interaction(),
        quality=aggregate_quality(
            records,
            media_kind,
            duration_sec,
            analysis_fps,
            width,
            height,
            source_fps,
            audio_samples,
        ),
        windows=build_windows_features(records, duration_sec, window_sec, events),
    )


def count_measurements(features: InterviewFeatures) -> int:
    """Number of valid measurements in the aggregate — for metrics/logging."""
    count = 0
    for group_name in (
        "visual",
        "body",
        "hands",
        "speech",
        "voice",
        "interaction",
        "quality",
    ):
        group = getattr(features, group_name)
        for field_name in type(group).model_fields:
            measurement = getattr(group, field_name)
            if isinstance(measurement, Measurement) and measurement.valid:
                count += 1
    return count
