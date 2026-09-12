"""Normalized transcript schema shared between STT adapters and the pipeline.

STT providers return wildly different shapes; adapters that support word-level
timing normalize into this schema so downstream speech-feature extraction never
touches provider types.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class WordTiming(BaseModel):
    text: str
    start: float
    end: float
    confidence: float | None = None


class TranscriptSegment(BaseModel):
    speaker: str = "candidate"
    start: float
    end: float
    text: str
    confidence: float | None = None
    words: list[WordTiming] = Field(default_factory=list)


class NormalizedTranscript(BaseModel):
    segments: list[TranscriptSegment] = Field(default_factory=list)

    def full_text(self) -> str:
        """Plain-text transcript for persistence / API write-back."""
        return " ".join(seg.text.strip() for seg in self.segments if seg.text.strip())
