"""probe_media duration fallback chain (Step 1b of practice-interview-ux plan).

Chrome MediaRecorder WebM files carry no Duration element in the EBML
header, so ffprobe reports format.duration as N/A even for valid media.
The probe must fall back to stream durations, then an ffmpeg -c copy remux,
before declaring CORRUPT_MEDIA.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from app.analysis.errors import CorruptMediaError
from app.analysis.media import probe_media


def _ffprobe_result(payload: dict) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["ffprobe"], returncode=0, stdout=json.dumps(payload).encode(), stderr=b""
    )


def _run_stub(
    probe_by_path: dict[str, dict],
    remux_ok: bool = True,
):
    """Build a subprocess.run stand-in keyed by the probed path."""

    def _run(cmd, capture_output, check):  # noqa: ANN001, ANN202 - matches signature use
        if cmd[0] == "ffprobe":
            payload = probe_by_path.get(cmd[-1])
            if payload is None:
                return subprocess.CompletedProcess(args=cmd, returncode=1, stdout=b"", stderr=b"boom")
            return _ffprobe_result(payload)
        if cmd[0] == "ffmpeg":
            # Simulate the remux writing a file ffmpeg would write.
            if remux_ok:
                Path(cmd[-1]).write_bytes(b"remuxed")
            return subprocess.CompletedProcess(
                args=cmd, returncode=0 if remux_ok else 1, stdout=b"", stderr=b""
            )
        raise AssertionError(f"unexpected command: {cmd}")

    return _run


def test_format_duration_n_a_falls_back_to_max_stream_duration(tmp_path, monkeypatch):
    media = tmp_path / "clip.webm"
    media.write_bytes(b"fake")
    monkeypatch.setattr(
        subprocess,
        "run",
        _run_stub(
            {
                str(media): {
                    "format": {"duration": "N/A"},
                    "streams": [
                        {"codec_type": "video", "duration": "12.5", "avg_frame_rate": "30/1"},
                        {"codec_type": "audio", "duration": "12.7"},
                    ],
                }
            }
        ),
    )
    meta = probe_media(media)
    assert meta.duration_sec == pytest.approx(12.7)


def test_missing_everywhere_recovers_via_remux(tmp_path, monkeypatch):
    media = tmp_path / "clip.webm"
    media.write_bytes(b"fake")
    remuxed = tmp_path / "clip.webm.remux.webm"
    monkeypatch.setattr(
        subprocess,
        "run",
        _run_stub(
            {
                str(media): {
                    "format": {"duration": "N/A"},
                    "streams": [{"codec_type": "video", "avg_frame_rate": "30/1"}],
                },
                str(remuxed): {
                    "format": {"duration": "8.25"},
                    "streams": [{"codec_type": "video", "avg_frame_rate": "30/1"}],
                },
            }
        ),
    )
    meta = probe_media(media)
    assert meta.duration_sec == pytest.approx(8.25)
    # The remux artifact must not leak next to the original.
    assert not remuxed.exists()


def test_genuinely_corrupt_media_still_raises(tmp_path, monkeypatch):
    media = tmp_path / "clip.webm"
    media.write_bytes(b"fake")
    empty_probe = {"format": {"duration": "N/A"}, "streams": [{"codec_type": "video"}]}
    monkeypatch.setattr(
        subprocess,
        "run",
        _run_stub({str(media): empty_probe, str(tmp_path / "clip.webm.remux.webm"): empty_probe}),
    )
    with pytest.raises(CorruptMediaError, match="no readable duration"):
        probe_media(media)


def test_unparseable_probe_output_raises(tmp_path, monkeypatch):
    media = tmp_path / "clip.webm"
    media.write_bytes(b"fake")
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda cmd, capture_output, check: subprocess.CompletedProcess(
            args=cmd, returncode=0, stdout=b"not json", stderr=b""
        ),
    )
    with pytest.raises(CorruptMediaError):
        probe_media(media)
