"""Pure geometry for visual feature extraction.

All functions operate on plain numpy landmark arrays (normalized image
coordinates) so they are unit-testable without MediaPipe. Everything here is
observable geometry: gaze is an iris-vs-eye-corner ratio, head pose comes from
solvePnP against a generic 3D face model, posture is shoulder/hip verticality.
No identity, emotion, or intent inference.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

# --- MediaPipe Face Mesh landmark indices -----------------------------------
LEFT_IRIS = 468
RIGHT_IRIS = 473
# Eye corners ordered so that a LOWER ratio consistently means "gaze towards
# image-left" for BOTH eyes (see gaze_from_landmarks).
LEFT_EYE_ORIGIN, LEFT_EYE_EXTENT = 33, 133
RIGHT_EYE_ORIGIN, RIGHT_EYE_EXTENT = 263, 362
LEFT_EYE_TOP, LEFT_EYE_BOTTOM = 159, 145
RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM = 386, 374
# Mouth: upper/lower inner lip, left/right mouth corners.
MOUTH_UPPER, MOUTH_LOWER, MOUTH_LEFT, MOUTH_RIGHT = 13, 14, 61, 291
# Eyebrow midpoints and matching eye-top reference for eyebrow position.
LEFT_BROW, RIGHT_BROW = 105, 334
NOSE_TIP = 1
CHIN = 152

# Generic 3D face model (arbitrary units) for solvePnP head pose.
FACE_MODEL_3D = np.array(
    [
        (0.0, 0.0, 0.0),  # nose tip
        (0.0, -330.0, -65.0),  # chin
        (-225.0, 170.0, -135.0),  # left eye outer corner
        (225.0, 170.0, -135.0),  # right eye outer corner
        (-150.0, -150.0, -125.0),  # left mouth corner
        (150.0, -150.0, -125.0),  # right mouth corner
    ],
    dtype=np.float64,
)
FACE_MODEL_INDICES = (NOSE_TIP, CHIN, 33, 263, MOUTH_LEFT, MOUTH_RIGHT)

# --- MediaPipe Pose landmark indices ----------------------------------------
LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12
LEFT_HIP, RIGHT_HIP = 23, 24
UPPER_BODY_INDICES = (11, 12, 13, 14, 15, 16)

GazeDirection = Literal["camera", "left", "right", "up", "down", "away"]

# Deviation below which gaze counts as directed at the camera.
GAZE_CAMERA_THRESHOLD = 0.15
# |lean| below which posture counts as upright, degrees from vertical.
UPRIGHT_LEAN_DEG = 15.0
# Minimum mean landmark visibility for posture to be measurable at all.
POSTURE_VISIBILITY_THRESHOLD = 0.5
# |yaw| beyond which a head turn counts as "large", degrees.
LARGE_HEAD_TURN_DEG = 35.0


@dataclass(frozen=True)
class GazeResult:
    direction: GazeDirection
    deviation: float
    horizontal: float
    vertical: float


@dataclass(frozen=True)
class HeadPose:
    yaw: float
    pitch: float
    roll: float


@dataclass(frozen=True)
class PostureResult:
    valid: bool
    visibility: float
    upright: bool | None
    lean_deg: float | None


def _ratio(origin: float, extent: float, point: float) -> float | None:
    span = float(extent - origin)
    if abs(span) < 1e-6:
        return None
    return float((point - origin) / span)


def gaze_from_landmarks(lm: npt.NDArray[np.float64]) -> GazeResult | None:
    """Geometry-based gaze from iris position relative to eye corners.

    ``lm`` is the (>=478, 2+) face-landmark array in normalized coordinates.
    Deviations are centered at 0; ``deviation`` is the euclidean magnitude.
    Direction is relative to the image: 'left'/'right' mean image-left/right.
    """
    if lm.shape[0] <= RIGHT_IRIS:
        return None

    horizontal_parts: list[float] = []
    for iris, origin, extent in (
        (LEFT_IRIS, LEFT_EYE_ORIGIN, LEFT_EYE_EXTENT),
        (RIGHT_IRIS, RIGHT_EYE_ORIGIN, RIGHT_EYE_EXTENT),
    ):
        r = _ratio(lm[origin, 0], lm[extent, 0], lm[iris, 0])
        if r is None:
            return None
        horizontal_parts.append(r - 0.5)
    horizontal = float(np.mean(horizontal_parts))

    vertical_parts: list[float] = []
    for iris, top, bottom in (
        (LEFT_IRIS, LEFT_EYE_TOP, LEFT_EYE_BOTTOM),
        (RIGHT_IRIS, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM),
    ):
        r = _ratio(lm[top, 1], lm[bottom, 1], lm[iris, 1])
        if r is None:
            return None
        vertical_parts.append(r - 0.5)
    vertical = float(np.mean(vertical_parts))

    deviation = float(math.hypot(horizontal, vertical))
    if deviation < GAZE_CAMERA_THRESHOLD:
        direction: GazeDirection = "camera"
    elif abs(horizontal) >= abs(vertical):
        direction = "left" if horizontal < 0 else "right"
    else:
        direction = "up" if vertical < 0 else "down"
    return GazeResult(
        direction=direction,
        deviation=deviation,
        horizontal=horizontal,
        vertical=vertical,
    )


def head_pose_from_landmarks(
    lm: npt.NDArray[np.float64],
    frame_width: int,
    frame_height: int,
) -> HeadPose | None:
    """Yaw/pitch/roll in degrees via solvePnP with a generic 3D face model."""
    import cv2

    if lm.shape[0] <= max(FACE_MODEL_INDICES):
        return None
    image_points = np.array(
        [(lm[i, 0] * frame_width, lm[i, 1] * frame_height) for i in FACE_MODEL_INDICES],
        dtype=np.float64,
    )
    focal = float(frame_width)
    camera_matrix = np.array(
        [[focal, 0.0, frame_width / 2.0], [0.0, focal, frame_height / 2.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    dist_coeffs = np.zeros((4, 1), dtype=np.float64)
    ok, rotation_vec, _translation = cv2.solvePnP(
        FACE_MODEL_3D,
        image_points,
        camera_matrix,
        dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok:
        return None
    rotation_mat, _ = cv2.Rodrigues(rotation_vec)
    # The generic face model is y-up while image coordinates are y-down, so a
    # frontal face solves to a 180° flip about the x-axis. Express the pose
    # relative to that frontal orientation so yaw/pitch/roll center on 0.
    frontal: npt.NDArray[np.float64] = np.array(
        [[1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, -1.0]], dtype=np.float64
    )
    return _euler_from_rotation(frontal @ np.asarray(rotation_mat, dtype=np.float64))


def _euler_from_rotation(rotation: npt.NDArray[np.float64]) -> HeadPose:
    sy = math.sqrt(float(rotation[0, 0] ** 2 + rotation[1, 0] ** 2))
    if sy < 1e-6:
        pitch = math.atan2(float(-rotation[1, 2]), float(rotation[1, 1]))
        yaw = math.atan2(float(-rotation[2, 0]), sy)
        roll = 0.0
    else:
        pitch = math.atan2(float(rotation[2, 1]), float(rotation[2, 2]))
        yaw = math.atan2(float(-rotation[2, 0]), sy)
        roll = math.atan2(float(rotation[1, 0]), float(rotation[0, 0]))
    return HeadPose(
        yaw=math.degrees(yaw),
        pitch=math.degrees(pitch),
        roll=math.degrees(roll),
    )


def facial_geometry(lm: npt.NDArray[np.float64]) -> tuple[float, float, float] | None:
    """(mouth_opening, mouth_width, eyebrow_position) from face landmarks.

    Distances are normalized by the eye-corner span so they are roughly
    scale-invariant. Eyebrow position is the brow-to-eye-top vertical gap.
    """
    if lm.shape[0] <= RIGHT_BROW:
        return None
    eye_span = float(abs(lm[LEFT_EYE_EXTENT, 0] - lm[LEFT_EYE_ORIGIN, 0]))
    if eye_span < 1e-6:
        return None
    mouth_opening = float(abs(lm[MOUTH_LOWER, 1] - lm[MOUTH_UPPER, 1])) / eye_span
    mouth_width = float(abs(lm[MOUTH_RIGHT, 0] - lm[MOUTH_LEFT, 0])) / eye_span
    brow_gap = (
        float(abs(lm[LEFT_BROW, 1] - lm[LEFT_EYE_TOP, 1]))
        + float(abs(lm[RIGHT_BROW, 1] - lm[RIGHT_EYE_TOP, 1]))
    ) / 2.0
    eyebrow_position = brow_gap / eye_span
    return mouth_opening, mouth_width, eyebrow_position


def posture_from_landmarks(pose: npt.NDArray[np.float64]) -> PostureResult:
    """Posture from pose landmarks. ``pose`` is (33, 4): x, y, z, visibility.

    Insufficient landmark visibility yields ``valid=False`` — that means
    "posture cannot be measured", never "poor posture".
    """
    if pose.shape[0] <= RIGHT_HIP or pose.shape[1] < 4:
        return PostureResult(valid=False, visibility=0.0, upright=None, lean_deg=None)
    key = (LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
    visibility = float(np.mean([pose[i, 3] for i in key]))
    if visibility < POSTURE_VISIBILITY_THRESHOLD:
        return PostureResult(valid=False, visibility=visibility, upright=None, lean_deg=None)
    shoulder_mid = (pose[LEFT_SHOULDER, :2] + pose[RIGHT_SHOULDER, :2]) / 2.0
    hip_mid = (pose[LEFT_HIP, :2] + pose[RIGHT_HIP, :2]) / 2.0
    delta = shoulder_mid - hip_mid
    # Image y points down; a perfectly upright torso is delta = (0, -|h|).
    lean_deg = math.degrees(math.atan2(float(delta[0]), float(-delta[1])))
    return PostureResult(
        valid=True,
        visibility=visibility,
        upright=abs(lean_deg) < UPRIGHT_LEAN_DEG,
        lean_deg=lean_deg,
    )


def upper_body_positions(
    pose: npt.NDArray[np.float64],
) -> npt.NDArray[np.float64] | None:
    """(6, 2) array of shoulder/elbow/wrist positions, or None if unusable."""
    if pose.shape[0] <= max(UPPER_BODY_INDICES):
        return None
    return pose[list(UPPER_BODY_INDICES), :2].copy()


def movement_magnitude(prev: npt.NDArray[np.float64], cur: npt.NDArray[np.float64]) -> float:
    """Mean euclidean displacement between two matching landmark sets."""
    if prev.shape != cur.shape or prev.size == 0:
        return 0.0
    return float(np.mean(np.linalg.norm(cur - prev, axis=1)))


def count_large_head_turns(yaws: list[float], threshold_deg: float = LARGE_HEAD_TURN_DEG) -> int:
    """Count contiguous excursions where |yaw| exceeds the threshold."""
    count = 0
    in_turn = False
    for yaw in yaws:
        if abs(yaw) >= threshold_deg:
            if not in_turn:
                count += 1
                in_turn = True
        else:
            in_turn = False
    return count


def movement_bursts(
    movements: list[float],
    threshold: float,
    max_gap: int = 1,
) -> list[tuple[int, int]]:
    """Group above-threshold movement frames into (start_idx, end_idx) bursts.

    Gaps of up to ``max_gap`` below-threshold frames are merged into the
    surrounding burst. Movement values are frame-to-frame, so index i covers
    the transition into frame i.
    """
    bursts: list[tuple[int, int]] = []
    start: int | None = None
    last_hot: int | None = None
    for idx, value in enumerate(movements):
        if value >= threshold:
            if start is None:
                start = idx
            elif last_hot is not None and idx - last_hot - 1 > max_gap:
                bursts.append((start, last_hot))
                start = idx
            last_hot = idx
    if start is not None and last_hot is not None:
        bursts.append((start, last_hot))
    return bursts
