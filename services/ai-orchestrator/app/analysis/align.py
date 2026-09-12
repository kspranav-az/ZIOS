"""Timeline alignment: one interview clock, Level-2 window bucketing.

All pipeline events carry ``{start, end}`` seconds from media start. This
module buckets timestamped metric points and discrete events into fixed
analysis windows (default 10 s) for the Level-2 ``WindowFeatures``. Pure
functions / stdlib only — no MediaPipe, fully unit-testable.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.analysis.schemas import WindowFeatures, WindowStats


@dataclass(frozen=True)
class Window:
    index: int
    start: float
    end: float


def build_windows(duration_sec: float, window_sec: float) -> list[Window]:
    """Fixed windows covering [0, duration_sec]; the last may be partial."""
    if duration_sec <= 0 or window_sec <= 0:
        return []
    windows: list[Window] = []
    start = 0.0
    index = 0
    while start < duration_sec:
        windows.append(Window(index=index, start=start, end=min(start + window_sec, duration_sec)))
        start += window_sec
        index += 1
    return windows


def window_index_for(timestamp: float, window_sec: float, window_count: int) -> int | None:
    if timestamp < 0 or window_sec <= 0 or window_count == 0:
        return None
    index = int(timestamp // window_sec)
    return min(index, window_count - 1)


@dataclass
class _Point:
    timestamp: float
    value: float


class WindowAccumulator:
    """Collects metric points and event counts, then emits WindowFeatures."""

    def __init__(self, duration_sec: float, window_sec: float) -> None:
        self._windows = build_windows(duration_sec, window_sec)
        self._window_sec = window_sec
        self._points: dict[str, list[_Point]] = {}
        self._events: dict[str, list[float]] = {}

    @property
    def window_count(self) -> int:
        return len(self._windows)

    def add_point(self, metric: str, timestamp: float, value: float) -> None:
        self._points.setdefault(metric, []).append(_Point(timestamp, value))

    def add_event(self, event: str, timestamp: float) -> None:
        self._events.setdefault(event, []).append(timestamp)

    def build(self) -> list[WindowFeatures]:
        out: list[WindowFeatures] = []
        for window in self._windows:
            metrics: dict[str, WindowStats] = {}
            for metric, points in self._points.items():
                values = [
                    p.value
                    for p in points
                    if window.start <= p.timestamp < window.end
                    or (window.index == len(self._windows) - 1 and p.timestamp == window.end)
                ]
                if values:
                    metrics[metric] = _stats(values)
            counts: dict[str, int] = {}
            for event, times in self._events.items():
                count = sum(
                    1
                    for t in times
                    if window.start <= t < window.end
                    or (window.index == len(self._windows) - 1 and t == window.end)
                )
                if count:
                    counts[event] = count
            out.append(
                WindowFeatures(start=window.start, end=window.end, metrics=metrics, counts=counts)
            )
        return out


def _stats(values: list[float]) -> WindowStats:
    import statistics

    return WindowStats(
        mean=statistics.fmean(values),
        median=statistics.median(values),
        std=statistics.pstdev(values) if len(values) > 1 else 0.0,
        min=min(values),
        max=max(values),
        count=len(values),
    )


@dataclass
class IntervalEvent:
    """A span on the interview clock (VAD segment, pause, gesture burst)."""

    start: float
    end: float
    kind: str


def merge_intervals(intervals: list[IntervalEvent]) -> list[IntervalEvent]:
    """Merge overlapping/adjacent intervals of the same kind. Test helper."""
    merged: list[IntervalEvent] = []
    for interval in sorted(intervals, key=lambda i: (i.kind, i.start)):
        if merged and merged[-1].kind == interval.kind and interval.start <= merged[-1].end:
            merged[-1] = IntervalEvent(
                start=merged[-1].start,
                end=max(merged[-1].end, interval.end),
                kind=interval.kind,
            )
        else:
            merged.append(interval)
    return merged
