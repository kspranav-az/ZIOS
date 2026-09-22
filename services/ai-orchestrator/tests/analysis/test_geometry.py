"""Unit tests for visual geometry math (no MediaPipe needed).

Landmark arrays are synthetic: a (478, 3) zero array with only the indices
each function actually reads populated.
"""

from __future__ import annotations

import numpy as np

from app.analysis.visual import geometry


def _face_landmarks(
    iris_h: float = 0.5,
    iris_v: float = 0.5,
) -> np.ndarray:
    """Synthetic 478-landmark face with controllable iris ratios.

    Eye corners span x in [0.4, 0.6] and y in [0.3, 0.5]; the iris ratios
    (0..1, 0.5 = centered) place both irises consistently.
    """
    lm = np.zeros((478, 3), dtype=np.float64)
    for origin, extent, top, bottom, iris in (
        (
            geometry.LEFT_EYE_ORIGIN,
            geometry.LEFT_EYE_EXTENT,
            geometry.LEFT_EYE_TOP,
            geometry.LEFT_EYE_BOTTOM,
            geometry.LEFT_IRIS,
        ),
        (
            geometry.RIGHT_EYE_ORIGIN,
            geometry.RIGHT_EYE_EXTENT,
            geometry.RIGHT_EYE_TOP,
            geometry.RIGHT_EYE_BOTTOM,
            geometry.RIGHT_IRIS,
        ),
    ):
        lm[origin] = (0.4, 0.4, 0.0)
        lm[extent] = (0.6, 0.4, 0.0)
        lm[top] = (0.5, 0.3, 0.0)
        lm[bottom] = (0.5, 0.5, 0.0)
        lm[iris] = (0.4 + 0.2 * iris_h, 0.3 + 0.2 * iris_v, 0.0)
    # Mouth + brows for facial geometry.
    lm[geometry.MOUTH_UPPER] = (0.5, 0.7, 0.0)
    lm[geometry.MOUTH_LOWER] = (0.5, 0.75, 0.0)
    lm[geometry.MOUTH_LEFT] = (0.45, 0.72, 0.0)
    lm[geometry.MOUTH_RIGHT] = (0.55, 0.72, 0.0)
    lm[geometry.LEFT_BROW] = (0.45, 0.2, 0.0)
    lm[geometry.RIGHT_BROW] = (0.55, 0.2, 0.0)
    return lm


def test_gaze_centered_is_camera() -> None:
    gaze = geometry.gaze_from_landmarks(_face_landmarks(0.5, 0.5))
    assert gaze is not None
    assert gaze.direction == "camera"
    assert gaze.deviation < geometry.GAZE_CAMERA_THRESHOLD


def test_gaze_left_right_up_down() -> None:
    left = geometry.gaze_from_landmarks(_face_landmarks(0.0, 0.5))
    right = geometry.gaze_from_landmarks(_face_landmarks(1.0, 0.5))
    up = geometry.gaze_from_landmarks(_face_landmarks(0.5, 0.0))
    down = geometry.gaze_from_landmarks(_face_landmarks(0.5, 1.0))
    assert left is not None and left.direction == "left"
    assert right is not None and right.direction == "right"
    assert up is not None and up.direction == "up"
    assert down is not None and down.direction == "down"
    assert left.deviation > geometry.GAZE_CAMERA_THRESHOLD


def test_gaze_rejects_short_landmark_array() -> None:
    assert geometry.gaze_from_landmarks(np.zeros((100, 3))) is None


def test_head_pose_centered_face_near_zero() -> None:
    """A face matching the 3D model's proportions should pose near zero."""
    width, height = 640, 480
    lm = np.zeros((478, 3), dtype=np.float64)
    # Project the generic 3D model with identity rotation: x' = x + cx etc.
    scale = 0.5
    for idx, (x, y, _z) in zip(geometry.FACE_MODEL_INDICES, geometry.FACE_MODEL_3D, strict=True):
        lm[idx] = (0.5 + x * scale / width, 0.55 - y * scale / height, 0.0)
    pose = geometry.head_pose_from_landmarks(lm, width, height)
    assert pose is not None
    assert abs(pose.yaw) < 15.0
    assert abs(pose.pitch) < 15.0
    assert abs(pose.roll) < 15.0


def test_head_pose_turned_face_has_large_yaw() -> None:
    width, height = 640, 480
    lm = np.zeros((478, 3), dtype=np.float64)
    scale = 0.5
    # Simulate a yaw turn by compressing x asymmetrically: points on one side
    # of the nose bunch up (perspective foreshortening approximation).
    angle = np.radians(40.0)
    for idx, (x, y, z) in zip(geometry.FACE_MODEL_INDICES, geometry.FACE_MODEL_3D, strict=True):
        xr = x * np.cos(angle) + z * np.sin(angle)
        lm[idx] = (0.5 + xr * scale / width, 0.55 - y * scale / height, 0.0)
    pose = geometry.head_pose_from_landmarks(lm, width, height)
    assert pose is not None
    assert abs(pose.yaw) > 20.0


def _pose_landmarks(lean_deg: float = 0.0, visibility: float = 0.9) -> np.ndarray:
    """Synthetic (33, 4) pose array: hips at y=0.8, shoulders above."""
    pose = np.zeros((33, 4), dtype=np.float64)
    pose[:, 3] = visibility
    lean = np.radians(lean_deg)
    # Hips centered; shoulders offset horizontally by the lean angle.
    pose[geometry.LEFT_HIP] = (0.45, 0.8, 0.0, visibility)
    pose[geometry.RIGHT_HIP] = (0.55, 0.8, 0.0, visibility)
    dx = 0.4 * np.tan(lean)
    pose[geometry.LEFT_SHOULDER] = (0.45 + dx, 0.4, 0.0, visibility)
    pose[geometry.RIGHT_SHOULDER] = (0.55 + dx, 0.4, 0.0, visibility)
    return pose


def test_posture_upright_when_vertical() -> None:
    posture = geometry.posture_from_landmarks(_pose_landmarks(0.0))
    assert posture.valid is True
    assert posture.upright is True
    assert posture.lean_deg is not None and abs(posture.lean_deg) < 1.0


def test_posture_lean_detected() -> None:
    posture = geometry.posture_from_landmarks(_pose_landmarks(25.0))
    assert posture.valid is True
    assert posture.upright is False
    assert posture.lean_deg is not None and abs(posture.lean_deg - 25.0) < 2.0


def test_posture_invalid_when_landmarks_invisible() -> None:
    posture = geometry.posture_from_landmarks(_pose_landmarks(0.0, visibility=0.1))
    assert posture.valid is False
    assert posture.upright is None
    assert posture.lean_deg is None


def test_movement_magnitude() -> None:
    prev = np.array([[0.0, 0.0], [1.0, 0.0]])
    cur = np.array([[0.0, 0.0], [1.0, 3.0]])
    assert geometry.movement_magnitude(prev, cur) == 1.5


def test_movement_bursts_groups_and_bridges_gaps() -> None:
    movements = [0.0, 0.05, 0.0, 0.06, 0.0, 0.0, 0.04, 0.0]
    bursts = geometry.movement_bursts(movements, threshold=0.02, max_gap=1)
    assert bursts == [(1, 3), (6, 6)]


def test_count_large_head_turns() -> None:
    yaws = [0.0, 10.0, 40.0, 45.0, 10.0, -50.0, 0.0]
    assert geometry.count_large_head_turns(yaws) == 2


def test_facial_geometry_scale_invariant_shape() -> None:
    lm = _face_landmarks()
    result = geometry.facial_geometry(lm)
    assert result is not None
    mouth_opening, mouth_width, eyebrow = result
    assert mouth_opening > 0
    assert mouth_width > mouth_opening
    assert eyebrow > 0
