"""Silero VAD via onnxruntime (no torch dependency).

The pinned ``silero_vad.onnx`` (v5.1.2) is fetched at Docker build time or via
``ensure_models`` for local runs. The model consumes exactly 512-sample windows
at 16 kHz (32 ms per window — this is the model's required chunk size, not an
arbitrary choice) plus a recurrent state, and returns a speech probability.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import numpy as np
import numpy.typing as npt

from app.analysis.visual.models import SILERO_VAD, default_model_dir, find_model

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 512  # 32 ms at 16 kHz — the model's required chunk size
WINDOW_SEC = WINDOW_SAMPLES / SAMPLE_RATE


@dataclass(frozen=True)
class SpeechSegment:
    start: float
    end: float


def merge_speech_frames(
    speech_flags: list[bool],
    frame_sec: float,
    min_silence_gap_sec: float = 0.3,
    min_speech_sec: float = 0.25,
) -> list[SpeechSegment]:
    """Merge per-window speech flags into segments.

    Gaps shorter than ``min_silence_gap_sec`` are bridged; segments shorter
    than ``min_speech_sec`` are dropped. Pure function, unit-testable.
    """
    segments: list[SpeechSegment] = []
    start: float | None = None
    last_speech_end: float | None = None
    for idx, flag in enumerate(speech_flags):
        t = idx * frame_sec
        if flag:
            if start is None:
                start = t
            elif last_speech_end is not None and t - last_speech_end > min_silence_gap_sec:
                segments.append(SpeechSegment(start=start, end=last_speech_end))
                start = t
            last_speech_end = t + frame_sec
    if start is not None and last_speech_end is not None:
        segments.append(SpeechSegment(start=start, end=last_speech_end))
    return [s for s in segments if s.end - s.start >= min_speech_sec]


def pauses_from_segments(
    segments: list[SpeechSegment], min_pause_sec: float = 0.5
) -> list[SpeechSegment]:
    """Gaps of at least ``min_pause_sec`` between consecutive speech segments."""
    pauses: list[SpeechSegment] = []
    for prev, cur in pairwise(segments):
        gap = cur.start - prev.end
        if gap >= min_pause_sec:
            pauses.append(SpeechSegment(start=prev.end, end=cur.start))
    return pauses


class SileroVad:
    """Speech-probability inference over 16 kHz mono PCM float32."""

    def __init__(self, model_path: Path, threshold: float = 0.5) -> None:
        import onnxruntime

        self._threshold = threshold
        self._session = onnxruntime.InferenceSession(
            str(model_path), providers=["CPUExecutionProvider"]
        )

    @classmethod
    def from_default_dir(
        cls, threshold: float = 0.5, model_dir: Path | None = None
    ) -> SileroVad | None:
        """Build from the default model dir; None when the model is absent."""
        path = find_model(SILERO_VAD, model_dir or default_model_dir())
        if path is None:
            return None
        return cls(path, threshold)

    def speech_probabilities(self, samples: npt.NDArray[np.float32]) -> npt.NDArray[np.float64]:
        """One speech probability per 512-sample window."""
        if samples.ndim != 1:
            raise ValueError("expected a mono 1-D sample array")
        n_windows = samples.shape[0] // WINDOW_SAMPLES
        probs = np.zeros(n_windows, dtype=np.float64)
        if n_windows == 0:
            return probs
        state = np.zeros((2, 1, 128), dtype=np.float32)
        sr = np.array(SAMPLE_RATE, dtype=np.int64)
        for idx in range(n_windows):
            window = samples[idx * WINDOW_SAMPLES : (idx + 1) * WINDOW_SAMPLES].astype(np.float32)
            output, state = self._session.run(
                None,
                {"input": window.reshape(1, -1), "state": state, "sr": sr},
            )
            probs[idx] = float(np.asarray(output).reshape(-1)[0])
        return probs

    def speech_segments(self, samples: npt.NDArray[np.float32]) -> list[SpeechSegment]:
        probs = self.speech_probabilities(samples)
        flags = [bool(p >= self._threshold) for p in probs]
        return merge_speech_frames(flags, WINDOW_SEC)


def clipped_ratio(samples: npt.NDArray[np.float32], threshold: float = 0.999) -> float | None:
    """Fraction of samples at/near full scale; None when there is no audio."""
    if samples.size == 0:
        return None
    return float(np.mean(np.abs(samples) >= threshold))
