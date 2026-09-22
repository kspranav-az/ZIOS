"""Per-frame visual feature extraction via MediaPipe Tasks landmarkers.

Each landmarker group (face, pose, hands) is independently fault-tolerant: a
missing/corrupt model file or a runtime failure disables only that group (the
records keep ``None``/False and the group carries a reason), while the other
groups still compute. Frames are consumed sequentially; nothing is buffered.
"""

from __future__ import annotations

import importlib
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import structlog

from app.analysis.media import VideoFrame
from app.analysis.visual import geometry
from app.analysis.visual.models import (
    FACE_LANDMARKER,
    HAND_LANDMARKER,
    POSE_LANDMARKER,
    default_model_dir,
    find_model,
)

logger = structlog.get_logger()

GROUP_FACE = "face"
GROUP_POSE = "pose"
GROUP_HANDS = "hands"
_GROUP_ATTR = {
    GROUP_FACE: "_face_landmarker",
    GROUP_POSE: "_pose_landmarker",
    GROUP_HANDS: "_hand_landmarker",
}


@dataclass
class FrameVisualRecord:
    """Objective per-frame measurements; None means "not measurable here"."""

    timestamp: float
    blur_score: float
    face_visible: bool = False
    gaze_direction: str | None = None
    gaze_deviation: float | None = None
    head_yaw: float | None = None
    head_pitch: float | None = None
    head_roll: float | None = None
    mouth_opening: float | None = None
    mouth_width: float | None = None
    eye_openness: float | None = None
    eyebrow_position: float | None = None
    posture_valid: bool = False
    posture_upright: bool | None = None
    body_lean: float | None = None
    upper_body_movement: float | None = None
    pose_detected: bool = False
    hands_detected: bool = False
    hands_visible: int = 0
    hand_movement: float | None = None


@dataclass
class VisualExtractionResult:
    records: list[FrameVisualRecord] = field(default_factory=list)
    # group -> failure reason (absent key means the group ran).
    group_failures: dict[str, str] = field(default_factory=dict)
    frames_processed: int = 0


class VisualExtractor:
    """Runs the three landmarkers over a sequential frame iterator."""

    def __init__(self, model_dir: Path | None = None) -> None:
        self._model_dir = model_dir or default_model_dir()
        self._face_landmarker: Any | None = None
        self._pose_landmarker: Any | None = None
        self._hand_landmarker: Any | None = None
        self.group_failures: dict[str, str] = {}

    def _build_landmarkers(self) -> None:
        try:
            vision = importlib.import_module("mediapipe.tasks.python.vision")
            base = importlib.import_module("mediapipe.tasks.python.core.base_options")
            running_mode_module = importlib.import_module(
                "mediapipe.tasks.python.vision.core.vision_task_running_mode"
            )
        except ImportError as exc:
            reason = f"mediapipe_import_failed:{exc}"
            self.group_failures = {GROUP_FACE: reason, GROUP_POSE: reason, GROUP_HANDS: reason}
            return

        base_options_cls = base.BaseOptions
        running_image = running_mode_module.VisionTaskRunningMode.IMAGE

        specs = (
            (GROUP_FACE, FACE_LANDMARKER, "FaceLandmarker", "FaceLandmarkerOptions"),
            (GROUP_POSE, POSE_LANDMARKER, "PoseLandmarker", "PoseLandmarkerOptions"),
            (GROUP_HANDS, HAND_LANDMARKER, "HandLandmarker", "HandLandmarkerOptions"),
        )
        for group, spec, landmarker_name, options_name in specs:
            path = find_model(spec, self._model_dir)
            if path is None:
                self.group_failures[group] = f"{spec.name}_model_missing"
                continue
            try:
                options_cls = getattr(vision, options_name)
                landmarker_cls = getattr(vision, landmarker_name)
                kwargs: dict[str, Any] = {}
                if group == GROUP_HANDS:
                    kwargs["num_hands"] = 2
                options = options_cls(
                    base_options=base_options_cls(model_asset_path=str(path)),
                    running_mode=running_image,
                    **kwargs,
                )
                landmarker = landmarker_cls.create_from_options(options)
                setattr(self, _GROUP_ATTR[group], landmarker)
            except Exception as exc:  # corrupt model, delegate mismatch, ...
                self.group_failures[group] = f"{spec.name}_load_failed:{exc}"
                logger.warning("landmarker_load_failed", group=group, error=str(exc))

    def analyze(self, frames: Iterable[VideoFrame]) -> VisualExtractionResult:
        try:
            self._build_landmarkers()
        except Exception as exc:  # init must never kill the frame loop
            reason = f"landmarker_init_failed:{exc}"
            self.group_failures = {g: reason for g in (GROUP_FACE, GROUP_POSE, GROUP_HANDS)}
        result = VisualExtractionResult(group_failures=dict(self.group_failures))
        prev_facial: tuple[float, float, float] | None = None
        prev_upper_body: npt.NDArray[np.float64] | None = None
        prev_wrists: list[npt.NDArray[np.float64]] | None = None

        try:
            mp_image_module = importlib.import_module("mediapipe")
            image_cls = mp_image_module.Image
            image_format = mp_image_module.ImageFormat.SRGB
        except ImportError:
            image_cls = None
            image_format = None

        for frame in frames:
            record = FrameVisualRecord(
                timestamp=frame.timestamp,
                blur_score=_blur_score(frame.image),
            )
            result.frames_processed += 1
            if image_cls is None:
                result.records.append(record)
                continue
            mp_image = image_cls(image_format=image_format, data=frame.image)

            face_lm = self._face_landmarks(mp_image, result)
            if face_lm is not None:
                record.face_visible = True
                self._fill_face(record, face_lm, frame, prev_facial)
                facial = geometry.facial_geometry(face_lm)
                prev_facial = facial
            else:
                record.gaze_direction = "away"
                prev_facial = None

            pose_lm = self._pose_landmarks(mp_image, result)
            if pose_lm is not None:
                record.pose_detected = True
                posture = geometry.posture_from_landmarks(pose_lm)
                record.posture_valid = posture.valid
                record.posture_upright = posture.upright
                record.body_lean = posture.lean_deg
                upper = geometry.upper_body_positions(pose_lm)
                if upper is not None and prev_upper_body is not None:
                    record.upper_body_movement = geometry.movement_magnitude(prev_upper_body, upper)
                prev_upper_body = upper
            else:
                prev_upper_body = None

            wrists = self._hand_wrists(mp_image, result)
            if wrists is not None:
                record.hands_detected = len(wrists) > 0
                record.hands_visible = len(wrists)
                if prev_wrists is not None and wrists and prev_wrists:
                    pairs = min(len(wrists), len(prev_wrists))
                    record.hand_movement = float(
                        np.mean(
                            [
                                geometry.movement_magnitude(
                                    prev_wrists[i].reshape(1, 2), wrists[i].reshape(1, 2)
                                )
                                for i in range(pairs)
                            ]
                        )
                    )
                prev_wrists = wrists
            else:
                prev_wrists = None

            result.records.append(record)
        return result

    def _fill_face(
        self,
        record: FrameVisualRecord,
        face_lm: npt.NDArray[np.float64],
        frame: VideoFrame,
        prev_facial: tuple[float, float, float] | None,
    ) -> None:
        gaze = geometry.gaze_from_landmarks(face_lm)
        if gaze is not None:
            record.gaze_direction = gaze.direction
            record.gaze_deviation = gaze.deviation
        height, width = frame.image.shape[:2]
        pose = geometry.head_pose_from_landmarks(face_lm, width, height)
        if pose is not None:
            record.head_yaw = pose.yaw
            record.head_pitch = pose.pitch
            record.head_roll = pose.roll
        facial = geometry.facial_geometry(face_lm)
        if facial is not None:
            record.mouth_opening, record.mouth_width, record.eyebrow_position = facial
            record.eye_openness = _eye_openness(face_lm)
        _ = prev_facial  # facial deltas are computed at aggregation time

    def _face_landmarks(
        self, mp_image: Any, result: VisualExtractionResult
    ) -> npt.NDArray[np.float64] | None:
        if self._face_landmarker is None:
            return None
        try:
            detection = self._face_landmarker.detect(mp_image)
        except Exception as exc:
            self._disable_group(GROUP_FACE, result, exc)
            return None
        if not detection.face_landmarks:
            return None
        return np.array(
            [[lm.x, lm.y, lm.z] for lm in detection.face_landmarks[0]], dtype=np.float64
        )

    def _pose_landmarks(
        self, mp_image: Any, result: VisualExtractionResult
    ) -> npt.NDArray[np.float64] | None:
        if self._pose_landmarker is None:
            return None
        try:
            detection = self._pose_landmarker.detect(mp_image)
        except Exception as exc:
            self._disable_group(GROUP_POSE, result, exc)
            return None
        if not detection.pose_landmarks:
            return None
        return np.array(
            [
                [lm.x, lm.y, lm.z, getattr(lm, "visibility", 1.0)]
                for lm in detection.pose_landmarks[0]
            ],
            dtype=np.float64,
        )

    def _hand_wrists(
        self, mp_image: Any, result: VisualExtractionResult
    ) -> list[npt.NDArray[np.float64]] | None:
        if self._hand_landmarker is None:
            return None
        try:
            detection = self._hand_landmarker.detect(mp_image)
        except Exception as exc:
            self._disable_group(GROUP_HANDS, result, exc)
            return None
        if detection.hand_landmarks is None:
            return None
        return [
            np.array([hand[0].x, hand[0].y], dtype=np.float64) for hand in detection.hand_landmarks
        ]

    def _disable_group(self, group: str, result: VisualExtractionResult, exc: Exception) -> None:
        reason = f"{group}_runtime_failed:{exc}"
        self.group_failures[group] = reason
        result.group_failures[group] = reason
        setattr(self, _GROUP_ATTR[group], None)
        logger.warning("landmarker_runtime_failed", group=group, error=str(exc))

    def close(self) -> None:
        for attr in ("_face_landmarker", "_pose_landmarker", "_hand_landmarker"):
            landmarker = getattr(self, attr)
            if landmarker is not None:
                try:
                    landmarker.close()
                except Exception:
                    pass
                setattr(self, attr, None)


def _blur_score(image: npt.NDArray[np.uint8]) -> float:
    """Laplacian-variance blur score; lower means blurrier."""
    import cv2

    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _eye_openness(lm: npt.NDArray[np.float64]) -> float | None:
    """Mean vertical eye opening normalized by the eye-corner span."""
    eye_span = float(abs(lm[geometry.LEFT_EYE_EXTENT, 0] - lm[geometry.LEFT_EYE_ORIGIN, 0]))
    if eye_span < 1e-6:
        return None
    opening = (
        float(abs(lm[geometry.LEFT_EYE_BOTTOM, 1] - lm[geometry.LEFT_EYE_TOP, 1]))
        + float(abs(lm[geometry.RIGHT_EYE_BOTTOM, 1] - lm[geometry.RIGHT_EYE_TOP, 1]))
    ) / 2.0
    return opening / eye_span
