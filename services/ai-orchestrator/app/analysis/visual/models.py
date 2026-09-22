"""Pinned MediaPipe / VAD model artifacts.

Model files are downloaded at Docker build time into ``/opt/mediapipe-models``
(see the Dockerfile) or, for local runs and tests, on demand into a user cache
via ``ensure_models``. Every artifact is sha256-verified; a mismatch is a hard
failure — we never run inference against an unverified model file.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

DOCKER_MODEL_DIR = Path("/opt/mediapipe-models")
LOCAL_CACHE_DIR = Path.home() / ".cache" / "zios-mediapipe"


@dataclass(frozen=True)
class ModelSpec:
    name: str
    filename: str
    url: str
    sha256: str


FACE_LANDMARKER = ModelSpec(
    name="face_landmarker",
    filename="face_landmarker.task",
    url=(
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task"
    ),
    sha256="64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
)

POSE_LANDMARKER = ModelSpec(
    name="pose_landmarker",
    filename="pose_landmarker_lite.task",
    url=(
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
    ),
    sha256="59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
)

HAND_LANDMARKER = ModelSpec(
    name="hand_landmarker",
    filename="hand_landmarker.task",
    url=(
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
        "hand_landmarker/float16/1/hand_landmarker.task"
    ),
    sha256="fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
)

SILERO_VAD = ModelSpec(
    name="silero_vad",
    filename="silero_vad.onnx",
    url="https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx",
    sha256="2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f",
)

ALL_MODELS: tuple[ModelSpec, ...] = (
    FACE_LANDMARKER,
    POSE_LANDMARKER,
    HAND_LANDMARKER,
    SILERO_VAD,
)


def default_model_dir() -> Path:
    """Model directory preference: env override, Docker path, user cache."""
    env_dir = os.environ.get("ANALYSIS_MODEL_DIR", "").strip()
    if env_dir:
        return Path(env_dir)
    if DOCKER_MODEL_DIR.is_dir():
        return DOCKER_MODEL_DIR
    return LOCAL_CACHE_DIR


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_model(spec: ModelSpec, model_dir: Path) -> Path:
    """Return the verified local path for ``spec``, downloading if needed."""
    dest = model_dir / spec.filename
    if dest.exists():
        if _sha256_of(dest) == spec.sha256:
            return dest
        dest.unlink()  # corrupt/partial file — re-download
    model_dir.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        urllib.request.urlretrieve(spec.url, tmp)
        if _sha256_of(tmp) != spec.sha256:
            raise RuntimeError(
                f"sha256 mismatch for {spec.name}: downloaded file does not match "
                f"the pinned checksum"
            )
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)
    return dest


def ensure_models(model_dir: Path | None = None) -> dict[str, Path]:
    """Ensure all pinned models exist locally. Returns name -> path."""
    directory = model_dir or default_model_dir()
    return {spec.name: ensure_model(spec, directory) for spec in ALL_MODELS}


def find_model(spec: ModelSpec, model_dir: Path | None = None) -> Path | None:
    """Return the verified path if the model is already present, else None.

    Never downloads — used by health checks and by extractors so a missing
    model degrades one feature group instead of blocking the pipeline.
    """
    directory = model_dir or default_model_dir()
    candidate = directory / spec.filename
    if candidate.is_file() and _sha256_of(candidate) == spec.sha256:
        return candidate
    return None
