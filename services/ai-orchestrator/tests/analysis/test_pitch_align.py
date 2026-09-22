"""Unit tests for pitch/energy summarization and timeline alignment."""

from __future__ import annotations

import numpy as np

from app.analysis.align import IntervalEvent, WindowAccumulator, build_windows, merge_intervals
from app.analysis.audio.pitch_energy import summarize_pitch, summarize_rms


def test_summarize_pitch_uses_voiced_frames_only() -> None:
    f0 = np.array([100.0, np.nan, 200.0, np.nan, 300.0])
    result = summarize_pitch(f0)
    assert result is not None
    mean, median, std, pitch_range = result
    assert mean == 200.0
    assert median == 200.0
    assert pitch_range == 200.0
    assert std > 0


def test_summarize_pitch_none_when_unvoiced() -> None:
    assert summarize_pitch(np.array([np.nan, np.nan])) is None
    assert summarize_pitch(np.array([100.0])) is None


def test_summarize_rms() -> None:
    result = summarize_rms(np.array([0.1, 0.2, 0.3]))
    assert result is not None
    mean, std, rms_range = result
    assert abs(mean - 0.2) < 1e-9
    assert std > 0
    assert abs(rms_range - 0.2) < 1e-9
    assert summarize_rms(np.array([0.1])) is None


def test_build_windows_partial_last_window() -> None:
    windows = build_windows(duration_sec=25.0, window_sec=10.0)
    assert [(w.start, w.end) for w in windows] == [(0.0, 10.0), (10.0, 20.0), (20.0, 25.0)]


def test_build_windows_empty_for_zero_duration() -> None:
    assert build_windows(0.0, 10.0) == []


def test_window_accumulator_stats_and_counts() -> None:
    acc = WindowAccumulator(duration_sec=20.0, window_sec=10.0)
    acc.add_point("gaze_deviation", 1.0, 0.1)
    acc.add_point("gaze_deviation", 2.0, 0.3)
    acc.add_point("gaze_deviation", 12.0, 0.9)
    acc.add_event("filler", 1.5)
    acc.add_event("filler", 11.0)
    acc.add_event("filler", 12.0)
    windows = acc.build()
    assert len(windows) == 2
    first = windows[0].metrics["gaze_deviation"]
    assert first.count == 2
    assert abs(first.mean - 0.2) < 1e-9
    assert first.min == 0.1
    assert first.max == 0.3
    second = windows[1].metrics["gaze_deviation"]
    assert second.count == 1
    assert second.std == 0.0
    assert windows[0].counts == {"filler": 1}
    assert windows[1].counts == {"filler": 2}


def test_merge_intervals_overlapping() -> None:
    merged = merge_intervals(
        [
            IntervalEvent(start=0.0, end=1.0, kind="speech"),
            IntervalEvent(start=0.5, end=2.0, kind="speech"),
            IntervalEvent(start=3.0, end=4.0, kind="speech"),
        ]
    )
    assert [(m.start, m.end) for m in merged] == [(0.0, 2.0), (3.0, 4.0)]
