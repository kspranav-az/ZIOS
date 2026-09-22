"""WebM (VP8/Opus) encoder for captured video-mode interview media.

Raw RGB24 video frames are streamed into a long-running ffmpeg subprocess via
its stdin pipe, so memory stays bounded regardless of session length. Audio
samples (mono s16le, 48 kHz ≈ 96 KB/s) are buffered with a hard cap and muxed
in with a second ffmpeg pass at finalize time.

The encoder never raises out of ``finalize``: on any failure it returns None
so the caller can fall back to the audio-only recording path.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from dataclasses import dataclass

import numpy as np
import structlog

logger = structlog.get_logger()

DEFAULT_FPS = 15
DEFAULT_MAX_WIDTH = 854
DEFAULT_AUDIO_RATE = 48000
DEFAULT_AUDIO_CHANNELS = 1
# ~10 minutes of mono s16le 48 kHz audio; older samples beyond this are dropped.
MAX_AUDIO_BUFFER_BYTES = 10 * 60 * DEFAULT_AUDIO_RATE * 2
# When ffmpeg's stdin backlog exceeds this, video frames are dropped instead
# of letting memory grow (encoder slower than realtime capture).
MAX_STDIN_BACKLOG_BYTES = 8 * 1024 * 1024
FFMPEG_TIMEOUT_S = 30


@dataclass
class EncodeStats:
    video_frames: int = 0
    video_frames_dropped: int = 0
    audio_bytes: int = 0
    audio_bytes_dropped: int = 0


def _target_size(width: int, height: int, max_width: int) -> tuple[int, int]:
    """Downscale to ``max_width`` preserving aspect; VP8/yuv420p needs even dims."""
    if width > max_width:
        height = round(height * max_width / width)
        width = max_width
    return max(width - (width % 2), 2), max(height - (height % 2), 2)


def _resize_rgb(rgb: bytes, width: int, height: int, target_w: int, target_h: int) -> bytes:
    """Resize an RGB24 frame with OpenCV; falls back to the raw frame on error."""
    import cv2

    arr = np.frombuffer(rgb, dtype=np.uint8).reshape(height, width, 3)
    resized = cv2.resize(arr, (target_w, target_h), interpolation=cv2.INTER_AREA)
    result: bytes = resized.tobytes()
    return result


def _read_bytes(path: str) -> bytes:
    """Synchronous file read (run via asyncio.to_thread from async callers)."""
    with open(path, "rb") as f:
        return f.read()


class WebmEncoder:
    """Incrementally encodes captured frames/samples into a single WebM file."""

    def __init__(
        self,
        fps: int = DEFAULT_FPS,
        max_width: int = DEFAULT_MAX_WIDTH,
        sample_rate: int = DEFAULT_AUDIO_RATE,
    ) -> None:
        self.fps = fps
        self.max_width = max_width
        self.sample_rate = sample_rate
        self.stats = EncodeStats()
        self._size: tuple[int, int] | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._video_path: str | None = None
        self._audio = bytearray()
        self._warned_rates: set[int] = set()

    @property
    def has_video(self) -> bool:
        return self.stats.video_frames > 0

    async def add_video_frame(self, rgb: bytes, width: int, height: int) -> None:
        """Append one RGB24 frame; the first frame fixes the output geometry."""
        if self._size is None:
            self._size = _target_size(width, height, self.max_width)
            await self._start()
        target_w, target_h = self._size
        frame = rgb
        if (width, height) != (target_w, target_h):
            try:
                frame = _resize_rgb(rgb, width, height, target_w, target_h)
            except Exception as exc:
                logger.warning("video_capture_resize_failed", error=str(exc))
                self.stats.video_frames_dropped += 1
                return
        proc = self._proc
        if proc is None or proc.stdin is None:
            return
        if proc.stdin.transport.get_write_buffer_size() > MAX_STDIN_BACKLOG_BYTES:
            self.stats.video_frames_dropped += 1
            return
        try:
            proc.stdin.write(frame)
            await proc.stdin.drain()
            self.stats.video_frames += 1
        except (BrokenPipeError, ConnectionResetError) as exc:
            logger.warning("video_capture_pipe_failed", error=str(exc))
            self.stats.video_frames_dropped += 1

    async def add_audio_frame(self, pcm: bytes, sample_rate: int, num_channels: int) -> None:
        """Buffer PCM16 samples; downmixes multi-channel audio to mono."""
        if sample_rate != self.sample_rate:
            if sample_rate not in self._warned_rates:
                self._warned_rates.add(sample_rate)
                logger.warning(
                    "video_capture_audio_rate_skipped",
                    sample_rate=sample_rate,
                    expected=self.sample_rate,
                )
            return
        if num_channels > 1:
            usable = len(pcm) - (len(pcm) % (2 * num_channels))
            arr = np.frombuffer(pcm[:usable], dtype=np.int16).reshape(-1, num_channels)
            pcm = np.ascontiguousarray(arr[:, 0]).tobytes()
        if len(self._audio) + len(pcm) > MAX_AUDIO_BUFFER_BYTES:
            self.stats.audio_bytes_dropped += len(pcm)
            return
        self._audio.extend(pcm)
        self.stats.audio_bytes += len(pcm)

    async def _start(self) -> None:
        """Spawn the video-encode ffmpeg process once the geometry is known."""
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg binary not found")
        assert self._size is not None
        width, height = self._size
        fd, self._video_path = tempfile.mkstemp(prefix="zios-capture-", suffix=".webm")
        os.close(fd)
        self._proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{width}x{height}",
            "-r",
            str(self.fps),
            "-i",
            "pipe:0",
            "-c:v",
            "libvpx",
            "-b:v",
            "800k",
            "-pix_fmt",
            "yuv420p",
            "-deadline",
            "realtime",
            self._video_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        logger.info("video_capture_encode_started", width=width, height=height, fps=self.fps)

    async def finalize(self) -> bytes | None:
        """Flush the encode and return the WebM bytes, or None on any failure.

        Returns None when no video frames were captured so the caller can fall
        back to the audio-only recording path.
        """
        try:
            return await self._finalize_inner()
        except Exception as exc:
            logger.warning("video_capture_finalize_failed", error=str(exc))
            return None
        finally:
            self._cleanup()

    async def _finalize_inner(self) -> bytes | None:
        proc = self._proc
        if proc is not None:
            if proc.stdin is not None:
                try:
                    proc.stdin.close()
                    await proc.stdin.wait_closed()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            try:
                rc = await asyncio.wait_for(proc.wait(), timeout=FFMPEG_TIMEOUT_S)
            except TimeoutError:
                proc.kill()
                await proc.wait()
                logger.warning("video_capture_ffmpeg_timeout")
                return None
            if rc != 0:
                logger.warning("video_capture_ffmpeg_failed", returncode=rc)
                return None
        if not self.has_video or self._video_path is None:
            return None
        if not self._audio:
            return await asyncio.to_thread(_read_bytes, self._video_path)
        return await self._mux_audio()

    async def _mux_audio(self) -> bytes | None:
        """Second ffmpeg pass: copy the VP8 stream and encode buffered audio as Opus."""
        assert self._video_path is not None
        audio_fd, audio_path = tempfile.mkstemp(prefix="zios-capture-", suffix=".s16")
        out_fd, out_path = tempfile.mkstemp(prefix="zios-capture-out-", suffix=".webm")
        try:
            with os.fdopen(audio_fd, "wb") as f:
                f.write(self._audio)
            os.close(out_fd)
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-y",
                "-i",
                self._video_path,
                "-f",
                "s16le",
                "-ar",
                str(self.sample_rate),
                "-ac",
                str(DEFAULT_AUDIO_CHANNELS),
                "-i",
                audio_path,
                "-c:v",
                "copy",
                "-c:a",
                "libopus",
                "-b:a",
                "64k",
                "-shortest",
                out_path,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            rc = await asyncio.wait_for(proc.wait(), timeout=FFMPEG_TIMEOUT_S)
            if rc != 0:
                logger.warning("video_capture_mux_failed", returncode=rc)
                return None
            return await asyncio.to_thread(_read_bytes, out_path)
        finally:
            for path in (audio_path, out_path):
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass

    def _cleanup(self) -> None:
        if self._video_path is not None:
            try:
                os.remove(self._video_path)
            except FileNotFoundError:
                pass
            self._video_path = None
