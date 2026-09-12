"""Speaking-rate features (WPM) from a normalized transcript + VAD segments.

WPM uses ACTUAL speaking time (VAD speech overlap within each transcript
segment), never total media duration, so pauses do not deflate the rate.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.analysis.audio.vad import SpeechSegment
from app.analysis.transcript_schema import NormalizedTranscript

MIN_WORDS_PER_SEGMENT = 3


@dataclass(frozen=True)
class SegmentWpm:
    start: float
    end: float
    wpm: float


@dataclass
class SpeechRateResult:
    segment_wpms: list[SegmentWpm] = field(default_factory=list)
    fast_segment_count: int = 0
    slow_segment_count: int = 0


def _speech_overlap(start: float, end: float, segments: list[SpeechSegment]) -> float:
    """Seconds of VAD speech inside [start, end]."""
    total = 0.0
    for seg in segments:
        overlap = min(end, seg.end) - max(start, seg.start)
        if overlap > 0:
            total += overlap
    return total


def compute_speech_rate(
    transcript: NormalizedTranscript,
    speech_segments: list[SpeechSegment],
    fast_wpm: float,
    slow_wpm: float,
) -> SpeechRateResult:
    """Per-transcript-segment WPM and fast/slow segment counts."""
    result = SpeechRateResult()
    for segment in transcript.segments:
        word_count = len(segment.words) if segment.words else len(segment.text.split())
        if word_count < MIN_WORDS_PER_SEGMENT:
            continue
        speaking_sec = _speech_overlap(segment.start, segment.end, speech_segments)
        if speaking_sec <= 0:
            # No VAD information (or no detected speech) — fall back to the
            # raw segment span so the measurement still has a basis.
            speaking_sec = segment.end - segment.start
        if speaking_sec <= 0:
            continue
        wpm = word_count / (speaking_sec / 60.0)
        result.segment_wpms.append(SegmentWpm(start=segment.start, end=segment.end, wpm=wpm))
        if wpm > fast_wpm:
            result.fast_segment_count += 1
        elif wpm < slow_wpm:
            result.slow_segment_count += 1
    return result


def estimate_word_timings(
    transcript: NormalizedTranscript,
    speech_segments: list[SpeechSegment],
) -> NormalizedTranscript:
    """Fill in missing word timings by spreading words over VAD speech.

    Fallback for STT adapters without word-level timing: each segment's words
    are distributed evenly across the VAD speech that overlaps the segment.
    Clearly a coarse estimate — downstream heuristics that depend on precise
    inter-word gaps must treat these as approximate.
    """
    if all(seg.words for seg in transcript.segments):
        return transcript
    from app.analysis.transcript_schema import WordTiming

    new_segments = []
    for segment in transcript.segments:
        if segment.words:
            new_segments.append(segment)
            continue
        words = segment.text.split()
        if not words:
            new_segments.append(segment)
            continue
        overlap = [
            SpeechSegment(
                start=max(segment.start, s.start),
                end=min(segment.end, s.end),
            )
            for s in speech_segments
            if min(segment.end, s.end) - max(segment.start, s.start) > 0
        ]
        span = sum(s.end - s.start for s in overlap)
        if span <= 0:
            overlap = [SpeechSegment(start=segment.start, end=segment.end)]
            span = max(segment.end - segment.start, 1e-3)
        per_word = span / len(words)
        timed_words: list[WordTiming] = []
        cursor = overlap[0].start
        overlap_idx = 0
        for word in words:
            start = cursor
            end = cursor + per_word
            timed_words.append(WordTiming(text=word, start=start, end=end))
            cursor = end
            while overlap_idx < len(overlap) - 1 and cursor > overlap[overlap_idx].end:
                overlap_idx += 1
                cursor = max(cursor, overlap[overlap_idx].start)
        new_segments.append(segment.model_copy(update={"words": timed_words}))
    return transcript.model_copy(update={"segments": new_segments})
