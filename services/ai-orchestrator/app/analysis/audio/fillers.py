"""Filler-word detection over a normalized transcript.

Vocabulary is configurable (``FILLER_WORDS`` env). Matching rules are
deliberately conservative and documented here — every result is flagged
``heuristic=true`` in the feature schema:

- Multi-word fillers ("you know", "sort of") are matched as exact phrases over
  consecutive words (case/punctuation-insensitive).
- Unambiguous single-word fillers ("um", "uh", "erm") always count.
- Ambiguous single words ("like", "actually", "basically") only count when
  they are plausibly disfluent: at a segment start, or adjacent to a pause
  (gap to the previous/next word >= ``PAUSE_ADJACENCY_SEC``). Words used as
  ordinary content ("like this approach") are intended to be excluded.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.analysis.transcript_schema import NormalizedTranscript, TranscriptSegment, WordTiming

AMBIGUOUS_SINGLE_WORDS = frozenset({"like", "actually", "basically"})
PAUSE_ADJACENCY_SEC = 0.3


@dataclass(frozen=True)
class FillerMatch:
    phrase: str
    start: float
    end: float
    word_count: int


@dataclass
class FillerResult:
    matches: list[FillerMatch] = field(default_factory=list)
    total_words: int = 0


def _normalize_word(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum() or ch == "'")


def _segment_words(segment: TranscriptSegment) -> list[WordTiming]:
    """Word timings for a segment, synthesizing untimed words if needed."""
    if segment.words:
        return segment.words
    words = segment.text.split()
    if not words:
        return []
    span = max(segment.end - segment.start, 1e-3)
    step = span / len(words)
    return [
        WordTiming(text=w, start=segment.start + i * step, end=segment.start + (i + 1) * step)
        for i, w in enumerate(words)
    ]


def _is_ambiguous_hit(words: list[WordTiming], index: int, *, segment_start: bool) -> bool:
    """Ambiguous single-word fillers require disfluency context."""
    if segment_start:
        return True
    word = words[index]
    if index > 0 and word.start - words[index - 1].end >= PAUSE_ADJACENCY_SEC:
        return True
    return bool(index < len(words) - 1 and words[index + 1].start - word.end >= PAUSE_ADJACENCY_SEC)


def detect_fillers(
    transcript: NormalizedTranscript,
    filler_words: tuple[str, ...],
) -> FillerResult:
    """Count filler occurrences across all transcript segments."""
    phrases = sorted(
        (tuple(p.split()) for p in filler_words if p.strip()),
        key=len,
        reverse=True,
    )
    result = FillerResult()

    for segment in transcript.segments:
        words = _segment_words(segment)
        normalized = [_normalize_word(w.text) for w in words]
        result.total_words += len(words)
        consumed: set[int] = set()

        for i in range(len(words)):
            if i in consumed or not normalized[i]:
                continue
            matched = False
            for phrase in phrases:
                n = len(phrase)
                if n == 1:
                    if normalized[i] != phrase[0]:
                        continue
                    if phrase[0] in AMBIGUOUS_SINGLE_WORDS and not _is_ambiguous_hit(
                        words, i, segment_start=(i == 0)
                    ):
                        continue
                    result.matches.append(
                        FillerMatch(
                            phrase=phrase[0],
                            start=words[i].start,
                            end=words[i].end,
                            word_count=1,
                        )
                    )
                    consumed.add(i)
                    matched = True
                    break
                if i + n > len(words):
                    continue
                if any(j in consumed for j in range(i, i + n)):
                    continue
                if tuple(normalized[i : i + n]) == phrase:
                    result.matches.append(
                        FillerMatch(
                            phrase=" ".join(phrase),
                            start=words[i].start,
                            end=words[i + n - 1].end,
                            word_count=n,
                        )
                    )
                    consumed.update(range(i, i + n))
                    matched = True
                    break
            _ = matched
    return result
