"""Unit tests for WPM, filler, and disfluency heuristics on synthetic transcripts."""

from __future__ import annotations

from app.analysis.audio.disfluency import detect_disfluencies
from app.analysis.audio.fillers import detect_fillers
from app.analysis.audio.vad import SpeechSegment
from app.analysis.audio.wpm import compute_speech_rate, estimate_word_timings
from app.analysis.transcript_schema import NormalizedTranscript, TranscriptSegment, WordTiming

FILLERS = ("um", "uh", "like", "you know", "actually")


def _transcript(text: str, start: float = 0.0, end: float = 4.0) -> NormalizedTranscript:
    words = text.split()
    step = (end - start) / len(words)
    return NormalizedTranscript(
        segments=[
            TranscriptSegment(
                start=start,
                end=end,
                text=text,
                words=[
                    WordTiming(text=w, start=start + i * step, end=start + (i + 1) * step)
                    for i, w in enumerate(words)
                ],
            )
        ]
    )


def test_wpm_uses_speaking_time_not_duration() -> None:
    # 12 words over a 12 s segment, but VAD says only 4 s of speech.
    transcript = _transcript(" ".join(f"w{i}" for i in range(12)), 0.0, 12.0)
    segments = [SpeechSegment(start=2.0, end=4.0), SpeechSegment(start=8.0, end=10.0)]
    rate = compute_speech_rate(transcript, segments, fast_wpm=180.0, slow_wpm=100.0)
    assert len(rate.segment_wpms) == 1
    # 12 words / (4 s / 60) = 180 wpm — not 60 wpm from the raw span.
    assert abs(rate.segment_wpms[0].wpm - 180.0) < 1e-6


def test_wpm_fast_slow_counts() -> None:
    fast = _transcript(" ".join(f"w{i}" for i in range(20)), 0.0, 4.0)  # 300 wpm
    slow = _transcript(" ".join(f"w{i}" for i in range(4)), 10.0, 14.0)  # 60 wpm
    transcript = NormalizedTranscript(segments=[*fast.segments, *slow.segments])
    rate = compute_speech_rate(transcript, [], fast_wpm=180.0, slow_wpm=100.0)
    assert rate.fast_segment_count == 1
    assert rate.slow_segment_count == 1


def test_estimate_word_timings_fills_missing() -> None:
    transcript = NormalizedTranscript(
        segments=[TranscriptSegment(start=0.0, end=4.0, text="one two three four")]
    )
    estimated = estimate_word_timings(transcript, [SpeechSegment(start=0.0, end=4.0)])
    words = estimated.segments[0].words
    assert len(words) == 4
    assert words[0].start == 0.0
    assert words[1].start == 1.0


def test_filler_counts_unambiguous_anywhere() -> None:
    transcript = _transcript("I um think this is um right")
    result = detect_fillers(transcript, FILLERS)
    phrases = sorted(m.phrase for m in result.matches)
    assert phrases == ["um", "um"]
    assert result.total_words == 7


def test_filler_multiword_phrase() -> None:
    transcript = _transcript("and you know we shipped it")
    result = detect_fillers(transcript, FILLERS)
    assert [m.phrase for m in result.matches] == ["you know"]
    assert result.matches[0].word_count == 2


def test_filler_ambiguous_word_needs_context() -> None:
    # "like" mid-sentence without pauses -> content word, not counted.
    content = _transcript("I would like this approach to work", 0.0, 3.5)
    assert detect_fillers(content, FILLERS).matches == []
    # "like" at segment start -> counted.
    disfluent = _transcript("like I said before", 0.0, 2.0)
    assert len(detect_fillers(disfluent, FILLERS).matches) == 1


def test_filler_ambiguous_word_after_pause() -> None:
    words = [
        WordTiming(text="think", start=0.0, end=0.5),
        WordTiming(text="like", start=1.5, end=1.8),  # 1.0 s gap before
        WordTiming(text="this", start=1.9, end=2.2),
    ]
    transcript = NormalizedTranscript(
        segments=[TranscriptSegment(start=0.0, end=2.2, text="think like this", words=words)]
    )
    result = detect_fillers(transcript, FILLERS)
    assert [m.phrase for m in result.matches] == ["like"]


def test_disfluency_immediate_repetition() -> None:
    result = detect_disfluencies(_transcript("I I think the the plan works"))
    assert result.repetition_count == 2


def test_disfluency_false_start_restart() -> None:
    result = detect_disfluencies(_transcript("I was I was going there"))
    assert result.false_start_count >= 1


def test_disfluency_self_correction_marker() -> None:
    result = detect_disfluencies(_transcript("we shipped Tuesday I mean Wednesday"))
    assert result.self_correction_count == 1


def test_disfluency_clean_transcript() -> None:
    result = detect_disfluencies(_transcript("the release went smoothly last week"))
    assert result.repetition_count == 0
    assert result.false_start_count == 0
    assert result.self_correction_count == 0
