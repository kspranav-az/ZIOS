# syntax=docker/dockerfile:1

# ---- model stage ------------------------------------------------------------
# Pinned MediaPipe Tasks models + Silero VAD + Piper TTS voice, sha256-verified
# at build time. The build FAILS on a checksum mismatch — we never ship
# unverified models.
FROM python:3.12-slim AS models
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /models
RUN set -euo pipefail; \
    curl -fsSL -o face_landmarker.task \
      https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task; \
    echo "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  face_landmarker.task" | sha256sum -c -; \
    curl -fsSL -o pose_landmarker_lite.task \
      https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task; \
    echo "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a  pose_landmarker_lite.task" | sha256sum -c -; \
    curl -fsSL -o hand_landmarker.task \
      https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task; \
    echo "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  hand_landmarker.task" | sha256sum -c -; \
    curl -fsSL -o silero_vad.onnx \
      https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx; \
    echo "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f  silero_vad.onnx" | sha256sum -c -; \
    curl -fsSL -o en_US-lessac-medium.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx; \
    echo "5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f  en_US-lessac-medium.onnx" | sha256sum -c -; \
    curl -fsSL -o en_US-lessac-medium.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json; \
    echo "efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0  en_US-lessac-medium.onnx.json" | sha256sum -c -

# ---- build stage ------------------------------------------------------------
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
RUN uv sync --frozen --no-dev

# ---- runtime stage ----------------------------------------------------------
FROM python:3.12-slim AS runner
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    ANALYSIS_MODEL_DIR=/opt/mediapipe-models \
    PIPER_MODEL_PATH=/opt/piper-models/en_US-lessac-medium.onnx

# ffmpeg extracts audio/decodes frames from uploaded async video answers.
# libgl1 + libglib2.0-0 are required by mediapipe's bundled OpenCV build.
# espeak-ng is Piper's phonemizer.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 espeak-ng && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.venv ./.venv
COPY app ./app
COPY --from=models /models /opt/mediapipe-models
COPY --from=models /models/en_US-lessac-medium.onnx /models/en_US-lessac-medium.onnx.json /opt/piper-models/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
