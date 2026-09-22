"""Unit tests for VAD segment merging, pauses, and audio quality helpers."""

from __future__ import annotations

import numpy as np

from app.analysis.audio.vad import (
    clipped_ratio,
    merge_speech_frames,
    pauses_from_segments,
)


def test_merge_speech_frames_basic() -> None:
    # 10 frames of 0.03 s: speech at frames 1-3 and 7-8.
    flags = [False, True, True, True, False, False, False, True, True, False]
    segments = merge_speech_frames(
        flags, frame_sec=0.03, min_silence_gap_sec=0.05, min_speech_sec=0.05
    )
    assert [(round(s.start, 3), round(s.end, 3)) for s in segments] == [
        (0.03, 0.12),
        (0.21, 0.27),
    ]


def test_merge_bridges_short_silence() -> None:
    # One-frame 0.03 s silence gap with 0.1 s tolerance -> single segment.
    flags = [True, True, False, True, True]
    segments = merge_speech_frames(
        flags, frame_sec=0.03, min_silence_gap_sec=0.1, min_speech_sec=0.01
    )
    assert len(segments) == 1
    assert segments[0].start == 0.0
    assert abs(segments[0].end - 0.15) < 1e-9


def test_merge_drops_short_segments() -> None:
    flags = [True, False, True, True, True]
    segments = merge_speech_frames(
        flags, frame_sec=0.03, min_silence_gap_sec=0.0, min_speech_sec=0.05
    )
    assert len(segments) == 1
    assert segments[0].start == 0.06


def test_pauses_from_segments() -> None:
    segments = merge_speech_frames(
        [True, True, False, False, True], frame_sec=0.5, min_speech_sec=0.1
    )
    pauses = pauses_from_segments(segments, min_pause_sec=0.5)
    assert len(pauses) == 1
    assert pauses[0].start == 1.0
    assert pauses[0].end == 2.0


def test_pauses_below_threshold_ignored() -> None:
    segments = merge_speech_frames(
        [True, False, True], frame_sec=0.3, min_silence_gap_sec=0.0, min_speech_sec=0.1
    )
    assert pauses_from_segments(segments, min_pause_sec=0.5) == []


def test_clipped_ratio() -> None:
    clean = np.zeros(100, dtype=np.float32)
    assert clipped_ratio(clean) == 0.0
    clipped = np.ones(100, dtype=np.float32)
    assert clipped_ratio(clipped) == 1.0
    assert clipped_ratio(np.zeros(0, dtype=np.float32)) is None
