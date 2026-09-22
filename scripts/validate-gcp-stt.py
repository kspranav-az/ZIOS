"""Live validation of GoogleCloudSttAdapter against real GCP Speech-to-Text v2.

One-off validation run (2026-09-22): transcribes a PCM16 16 kHz mono file
through the real adapter (no fakes) and prints transcript statistics.

Usage (from repo root, with ADC configured):
    ffmpeg -y -v error -i <media> -vn -ac 1 -ar 16000 -f s16le /tmp/clip.pcm
    cd services/ai-orchestrator
    GCP_PROJECT_ID=<project> ../scripts/validate-gcp-stt.py /tmp/clip.pcm
"""

from __future__ import annotations

import asyncio
import sys
import time

from app.analysis.stt.factory import build_stt_adapter
from app.analysis.config import load_settings


async def main() -> None:
    pcm_path = sys.argv[1]
    pcm = open(pcm_path, "rb").read()
    settings = load_settings()
    adapter = build_stt_adapter(settings)
    print(f"adapter: {type(adapter).__name__} (STT_ADAPTER={settings.stt_adapter})")
    started = time.monotonic()
    transcript = await adapter.transcribe_with_timestamps(pcm, sample_rate=16000)
    elapsed = time.monotonic() - started

    segments = transcript.segments
    words = [w for seg in segments for w in seg.words]
    confidences = [w.confidence for w in words if w.confidence is not None]
    speech_span = (words[-1].end - words[0].start) if words else 0.0

    print(f"wall time: {elapsed:.1f}s for {len(pcm) / 32000:.1f}s of audio")
    print(f"segments: {len(segments)}")
    print(f"words: {len(words)}")
    print(f"speech span: {speech_span:.1f}s")
    if confidences:
        avg = sum(confidences) / len(confidences)
        print(f"word confidence: avg {avg:.3f}, min {min(confidences):.3f}")
    print("--- transcript ---")
    print(transcript.full_text())


if __name__ == "__main__":
    asyncio.run(main())
