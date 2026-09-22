"""Disfluency detection: repetitions, false starts, self-corrections.

These are simple surface-pattern heuristics over the normalized transcript,
NOT linguistic judgments. Known limitations (documented per AGENTS.md
evidence discipline — every result is flagged ``heuristic=true``):

- Repetitions: immediate exact word repeats ("I I", "the the") after
  normalization. Legitimate emphasis ("very very") is indistinguishable.
- False starts: a word repeated after 1-2 intervening words ("I was I was
  going") counts as an abandoned-and-restarted phrase. This misses restarts
  with entirely different wording.
- Self-corrections: explicit correction markers ("I mean", "or rather",
  "sorry") following at least one content word. The marker phrases are fixed;
  other correction styles are not detected.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.analysis.transcript_schema import NormalizedTranscript

SELF_CORRECTION_MARKERS: tuple[tuple[str, ...], ...] = (
    ("i", "mean"),
    ("or", "rather"),
    ("sorry",),
)

FALSE_START_MAX_INTERVENING = 2


@dataclass
class DisfluencyResult:
    repetition_count: int = 0
    false_start_count: int = 0
    self_correction_count: int = 0
    # Timestamps (seconds) of detected events, for window-level counting.
    repetition_times: list[float] = field(default_factory=list)
    false_start_times: list[float] = field(default_factory=list)
    self_correction_times: list[float] = field(default_factory=list)


def _normalized_words(transcript: NormalizedTranscript) -> list[tuple[str, float]]:
    """Flatten (normalized word, start time) across segments, in order."""
    out: list[tuple[str, float]] = []
    for segment in transcript.segments:
        if segment.words:
            for w in segment.words:
                cleaned = "".join(ch for ch in w.text.lower() if ch.isalnum() or ch == "'")
                if cleaned:
                    out.append((cleaned, w.start))
        else:
            span = max(segment.end - segment.start, 1e-3)
            words = [w for w in segment.text.split() if w.strip()]
            step = span / max(len(words), 1)
            for i, raw in enumerate(words):
                cleaned = "".join(ch for ch in raw.lower() if ch.isalnum() or ch == "'")
                if cleaned:
                    out.append((cleaned, segment.start + i * step))
    return out


def detect_disfluencies(transcript: NormalizedTranscript) -> DisfluencyResult:
    words = _normalized_words(transcript)
    result = DisfluencyResult()
    texts = [w for w, _ in words]

    for i in range(len(words)):
        # Immediate exact repeats: "I I", "the the".
        # Immediate exact repeats: "I I", "the the".
        is_immediate_repeat = i + 1 < len(words) and texts[i] == texts[i + 1]
        if is_immediate_repeat:
            result.repetition_count += 1
            result.repetition_times.append(words[i][1])

        # False start: the word is abandoned and the phrase restarts — the
        # same word reappears 2-3 positions later ("I was I was going"), and
        # the immediate next word differs (otherwise it is a plain repetition).
        if not is_immediate_repeat:
            for j in range(i + 2, min(i + 2 + FALSE_START_MAX_INTERVENING, len(words))):
                if texts[i] == texts[j]:
                    result.false_start_count += 1
                    result.false_start_times.append(words[i][1])
                    break

        # Self-correction markers.
        for marker in SELF_CORRECTION_MARKERS:
            n = len(marker)
            if i >= 1 and i + n <= len(texts) and tuple(texts[i : i + n]) == marker:
                result.self_correction_count += 1
                result.self_correction_times.append(words[i][1])
                break
    return result
