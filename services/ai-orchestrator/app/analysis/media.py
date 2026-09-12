"""Media preprocessing: object download, ffprobe, ffmpeg decode.

Memory discipline: the video object is streamed to a unique temp dir on disk
in chunks (never held whole in Python memory); audio is extracted to a 16 kHz
mono PCM16 file; video frames are decoded SEQUENTIALLY through an ffmpeg
``image2pipe`` PPM stream so only one analysis-resolution frame is alive at a
time. The original MinIO object is never modified.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO, cast

import numpy as np
import numpy.typing as npt
import structlog

from app.analysis.errors import CorruptMediaError, FfmpegError, ObjectNotFoundError
from app.analysis.schemas import MediaMetadata

if TYPE_CHECKING:
    from app.storage import StorageClient

logger = structlog.get_logger()

AUDIO_SAMPLE_RATE = 16000
AUDIO_CHANNELS = 1
_DOWNLOAD_CHUNK = 1024 * 1024


@dataclass
class VideoFrame:
    """One decoded analysis-resolution frame on the interview clock."""

    timestamp: float
    frame_index: int
    image: npt.NDArray[np.uint8]  # HxWx3 uint8 RGB


def require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise FfmpegError("ffmpeg/ffprobe binaries not found on PATH")


def download_object(storage: StorageClient, object_name: str, dest_dir: Path) -> Path:
    """Stream a storage object to ``dest_dir`` and return the local path."""
    from minio.error import S3Error

    dest = dest_dir / "input_media"
    client = storage._client_instance()
    try:
        response = client.get_object(storage.bucket, object_name)
    except S3Error as exc:
        if exc.code in ("NoSuchKey", "NoSuchObject", "NoSuchBucket"):
            raise ObjectNotFoundError(f"object not found: {object_name}") from exc
        raise
    try:
        with open(dest, "wb") as out:
            for chunk in response.stream(_DOWNLOAD_CHUNK):
                out.write(chunk)
    finally:
        response.close()
        response.release_conn()
    return dest


def probe_media(path: Path) -> MediaMetadata:
    """ffprobe the media file; corrupt/unreadable media raises CORRUPT_MEDIA."""
    require_ffmpeg()
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, check=False)
    if result.returncode != 0:
        raise CorruptMediaError(
            f"ffprobe could not read media: {result.stderr.decode('utf-8', 'ignore')[:200]}"
        )
    try:
        info = json.loads(result.stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise CorruptMediaError("ffprobe returned unparseable output") from exc

    streams = info.get("streams") or []
    fmt = info.get("format") or {}
    duration_raw = fmt.get("duration")
    if duration_raw is None:
        raise CorruptMediaError("media has no readable duration")
    duration = float(duration_raw)

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    fps: float | None = None
    if video_stream is not None:
        fps = _parse_rate(video_stream.get("avg_frame_rate"))

    return MediaMetadata(
        duration_sec=duration,
        fps=fps,
        width=int(video_stream["width"]) if video_stream and video_stream.get("width") else None,
        height=int(video_stream["height"]) if video_stream and video_stream.get("height") else None,
        video_codec=video_stream.get("codec_name") if video_stream else None,
        audio_sample_rate=int(audio_stream["sample_rate"])
        if audio_stream and audio_stream.get("sample_rate")
        else None,
        audio_channels=int(audio_stream["channels"])
        if audio_stream and audio_stream.get("channels")
        else None,
    )


def _parse_rate(rate: object) -> float | None:
    if not isinstance(rate, str) or "/" not in rate:
        return None
    num, _, den = rate.partition("/")
    try:
        denominator = float(den)
        if denominator == 0:
            return None
        return float(num) / denominator
    except ValueError:
        return None


def extract_audio_pcm(src: Path, dest_dir: Path) -> Path:
    """Extract mono 16 kHz PCM16 (s16le) audio via ffmpeg. Returns the .pcm path."""
    require_ffmpeg()
    dest = dest_dir / "audio.pcm"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-vn",
        "-ac",
        str(AUDIO_CHANNELS),
        "-ar",
        str(AUDIO_SAMPLE_RATE),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, check=False)
    if result.returncode != 0 or not dest.exists():
        raise CorruptMediaError(
            "ffmpeg could not extract an audio track: "
            f"{result.stderr.decode('utf-8', 'ignore')[:200]}"
        )
    return dest


def load_pcm_float(pcm_path: Path) -> npt.NDArray[np.float32]:
    """Load raw s16le PCM as float32 in [-1, 1]."""
    samples = np.frombuffer(pcm_path.read_bytes(), dtype=np.int16)
    return samples.astype(np.float32) / 32768.0


def iter_video_frames(src: Path, fps: float, width: int) -> Iterator[VideoFrame]:
    """Decode video sequentially at ``fps`` / ``width`` via ffmpeg image2pipe.

    Frames arrive as PPM (P6) on stdout; exactly one frame is held in memory
    at a time and ownership passes to the caller (released after processing).
    Timestamps are frame_index / fps, i.e. on the interview clock.
    """
    require_ffmpeg()
    cmd = [
        "ffmpeg",
        "-i",
        str(src),
        "-vf",
        f"fps={fps},scale={width}:-2",
        "-an",
        "-f",
        "image2pipe",
        "-vcodec",
        "ppm",
        "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    stream = cast(BinaryIO, proc.stdout)
    frame_index = 0
    try:
        while True:
            header = _read_ppm_header(stream)
            if header is None:
                break
            frame_w, frame_h, maxval = header
            if maxval != 255:
                raise FfmpegError(f"unexpected PPM maxval {maxval}")
            raster = _read_exact(stream, frame_w * frame_h * 3)
            if raster is None:
                break
            image = np.frombuffer(raster, dtype=np.uint8).reshape((frame_h, frame_w, 3)).copy()
            yield VideoFrame(
                timestamp=frame_index / fps,
                frame_index=frame_index,
                image=image,
            )
            frame_index += 1
    finally:
        if proc.stdout is not None:
            proc.stdout.close()
        proc.wait()
    if proc.returncode != 0:
        raise FfmpegError(f"ffmpeg frame decode exited with code {proc.returncode}")


def _read_exact(stream: BinaryIO, n: int) -> bytes | None:
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


def _read_ppm_header(stream: BinaryIO) -> tuple[int, int, int] | None:
    """Parse a binary PPM (P6) header. Returns (width, height, maxval)."""
    tokens: list[bytes] = []
    current = bytearray()
    while len(tokens) < 4:
        byte = stream.read(1)
        if not byte:
            return None if not tokens else _finish(tokens, current)
        if byte == b"#":  # comment to end of line
            while byte not in (b"\n", b""):
                byte = stream.read(1)
            continue
        if byte.isspace():
            if current:
                tokens.append(bytes(current))
                current = bytearray()
            continue
        current.extend(byte)
    return _finish(tokens, current)


def _finish(tokens: list[bytes], trailing: bytearray) -> tuple[int, int, int] | None:
    if trailing:
        tokens.append(bytes(trailing))
    if len(tokens) < 4 or tokens[0] != b"P6":
        return None
    try:
        return int(tokens[1]), int(tokens[2]), int(tokens[3])
    except ValueError:
        return None
