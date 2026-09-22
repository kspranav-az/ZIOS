"""Pitch (f0) and energy (RMS) extraction over speech regions only.

Each VAD speech segment is analysed independently with librosa and the
resulting per-frame f0/RMS arrays are concatenated — we deliberately do NOT
concatenate the raw audio of separate segments, because splicing would create
artificial discontinuities that corrupt f0 tracking. Documented limitation:
pitch context is lost across segment boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from app.analysis.audio.vad import SAMPLE_RATE, SpeechSegment

MIN_F0_HZ = 65.0
MAX_F0_HZ = 400.0
# Below this much analysed speech, pitch/energy statistics are not meaningful.
MIN_SPEECH_SAMPLES = SAMPLE_RATE // 2  # 0.5 s


@dataclass(frozen=True)
class VoiceSeries:
    """Per-analysis-frame f0 (Hz, NaN where unvoiced) and RMS values."""

    f0_hz: npt.NDArray[np.float64]
    rms: npt.NDArray[np.float64]
    speech_samples: int


def extract_voice_series(
    samples: npt.NDArray[np.float32], segments: list[SpeechSegment]
) -> VoiceSeries | None:
    """f0 (pyin) + RMS over speech regions; None when speech is insufficient."""
    import librosa

    speech_samples = sum(
        max(0, int(seg.end * SAMPLE_RATE) - int(seg.start * SAMPLE_RATE)) for seg in segments
    )
    if not segments or speech_samples < MIN_SPEECH_SAMPLES:
        return None

    f0_parts: list[npt.NDArray[np.float64]] = []
    rms_parts: list[npt.NDArray[np.float64]] = []
    for seg in segments:
        start_idx = max(0, int(seg.start * SAMPLE_RATE))
        end_idx = min(samples.shape[0], int(seg.end * SAMPLE_RATE))
        if end_idx - start_idx < 2048:  # pyin needs at least one full frame
            continue
        clip = samples[start_idx:end_idx].astype(np.float32)
        f0, _voiced_flag, _voiced_prob = librosa.pyin(
            clip,
            fmin=MIN_F0_HZ,
            fmax=MAX_F0_HZ,
            sr=SAMPLE_RATE,
        )
        rms = librosa.feature.rms(y=clip)[0]
        f0_parts.append(np.asarray(f0, dtype=np.float64))
        rms_parts.append(np.asarray(rms, dtype=np.float64))

    if not f0_parts:
        return None
    return VoiceSeries(
        f0_hz=np.concatenate(f0_parts),
        rms=np.concatenate(rms_parts),
        speech_samples=speech_samples,
    )


def summarize_pitch(
    f0_hz: npt.NDArray[np.float64],
) -> tuple[float, float, float, float] | None:
    """(mean, median, std, range) over voiced frames; None if none are voiced."""
    voiced = f0_hz[~np.isnan(f0_hz)]
    if voiced.size < 2:
        return None
    return (
        float(np.mean(voiced)),
        float(np.median(voiced)),
        float(np.std(voiced)),
        float(np.max(voiced) - np.min(voiced)),
    )


def summarize_rms(rms: npt.NDArray[np.float64]) -> tuple[float, float, float] | None:
    """(mean, std, range) of RMS energy; None when empty."""
    if rms.size < 2:
        return None
    return (
        float(np.mean(rms)),
        float(np.std(rms)),
        float(np.max(rms) - np.min(rms)),
    )
