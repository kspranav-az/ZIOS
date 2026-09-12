"""Pipeline orchestration for multimodal interview feature extraction.

Stage order: download -> probe -> audio extraction -> visual (video only) ->
VAD -> transcript -> speech/voice features -> align -> aggregate -> persist.

Fault policy:
- Media unreadable / object missing: the whole job fails (404/422).
- STT failure when ``include_transcript`` is set: the whole job fails (502) —
  a fabricated transcript would poison downstream scoring.
- Visual/VAD stage failures degrade the affected feature groups to
  ``valid=False`` with reasons; the rest of the job still completes.

The temp working directory is always removed. Raw media and full transcript
text are NEVER logged — only counts and timings.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import time
from collections.abc import AsyncIterator
from dataclasses import asdict
from pathlib import Path

import numpy as np
import numpy.typing as npt
import structlog

from app.analysis.aggregate import build_interview_features, count_measurements
from app.analysis.audio.disfluency import DisfluencyResult, detect_disfluencies
from app.analysis.audio.fillers import FillerResult, detect_fillers
from app.analysis.audio.pitch_energy import extract_voice_series
from app.analysis.audio.vad import SAMPLE_RATE, SileroVad, SpeechSegment, pauses_from_segments
from app.analysis.audio.wpm import SpeechRateResult, compute_speech_rate, estimate_word_timings
from app.analysis.config import AnalysisSettings, load_settings
from app.analysis.errors import AnalysisError, InvalidRequestError, SttError
from app.analysis.media import (
    download_object,
    extract_audio_pcm,
    iter_video_frames,
    load_pcm_float,
    probe_media,
)
from app.analysis.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    AnalysisResultRef,
    InterviewFeatures,
    ProcessingMetrics,
)
from app.analysis.stt.factory import build_stt_adapter
from app.analysis.transcript_schema import NormalizedTranscript, TranscriptSegment
from app.analysis.visual.extractor import (
    GROUP_FACE,
    GROUP_HANDS,
    GROUP_POSE,
    FrameVisualRecord,
    VisualExtractor,
)
from app.analysis.visual.models import default_model_dir
from app.storage import StorageClient
from app.voice.ports import SttPort

logger = structlog.get_logger()


class AnalysisService:
    def __init__(
        self,
        settings: AnalysisSettings | None = None,
        storage: StorageClient | None = None,
        stt: SttPort | None = None,
    ) -> None:
        self.settings = settings or load_settings()
        self.storage = storage or StorageClient()
        self._stt = stt

    def _stt_adapter(self) -> SttPort:
        if self._stt is None:
            self._stt = build_stt_adapter(self.settings)
        return self._stt

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        if not request.consent_verified:
            raise InvalidRequestError(
                "consent_verified must be true; the API must verify consent "
                "before dispatching analysis jobs"
            )
        log = logger.bind(
            analysis_job_id=request.analysis_job_id,
            session_id=request.session_id,
            question_id=request.question_id,
        )
        started = time.perf_counter()
        temp_root = Path(self.settings.analysis_temp_dir or tempfile.gettempdir())
        await asyncio.to_thread(temp_root.mkdir, parents=True, exist_ok=True)
        workdir = Path(
            tempfile.mkdtemp(prefix=f"analysis-{request.analysis_job_id}-", dir=temp_root)
        )
        try:
            return await self._run(request, workdir, log, started)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    async def _run(
        self,
        request: AnalysisRequest,
        workdir: Path,
        log: structlog.stdlib.BoundLogger,
        started: float,
    ) -> AnalysisResponse:
        stage = "download"
        stage_started = time.perf_counter()
        media_path = await asyncio.to_thread(
            download_object, self.storage, request.object_name, workdir
        )
        metadata = await asyncio.to_thread(probe_media, media_path)
        log.info(
            "analysis_stage_completed",
            stage=stage,
            duration_ms=_elapsed_ms(stage_started),
            media_duration=metadata.duration_sec,
        )

        stage = "audio_extract"
        stage_started = time.perf_counter()
        audio_path = await asyncio.to_thread(extract_audio_pcm, media_path, workdir)
        samples = await asyncio.to_thread(load_pcm_float, audio_path)
        audio_duration_sec = float(samples.shape[0]) / SAMPLE_RATE
        log.info(
            "analysis_stage_completed",
            stage=stage,
            duration_ms=_elapsed_ms(stage_started),
            audio_duration_sec=audio_duration_sec,
        )

        records = []
        group_failures: dict[str, str] = {}
        frames_processed = 0
        if request.media_kind == "video" and metadata.video_codec is not None:
            stage = "visual"
            stage_started = time.perf_counter()
            extractor = VisualExtractor(
                model_dir=Path(self.settings.model_dir)
                if self.settings.model_dir
                else default_model_dir()
            )
            try:
                visual = await asyncio.to_thread(
                    extractor.analyze,
                    iter_video_frames(
                        media_path,
                        self.settings.video_analysis_fps,
                        self.settings.video_analysis_width,
                    ),
                )
                records = visual.records
                group_failures = visual.group_failures
                frames_processed = visual.frames_processed
            except AnalysisError:
                raise
            except Exception as exc:  # visual stage degrades, job continues
                reason = f"visual_stage_failed:{exc}"
                group_failures = {GROUP_FACE: reason, GROUP_POSE: reason, GROUP_HANDS: reason}
                log.warning("analysis_stage_failed", stage=stage, error=str(exc))
            finally:
                extractor.close()
            log.info(
                "analysis_stage_completed",
                stage=stage,
                duration_ms=_elapsed_ms(stage_started),
                frames_processed=frames_processed,
                group_failures=sorted(group_failures),
            )

        stage = "vad"
        stage_started = time.perf_counter()
        vad = await asyncio.to_thread(
            SileroVad.from_default_dir,
            self.settings.vad_threshold,
            Path(self.settings.model_dir) if self.settings.model_dir else default_model_dir(),
        )
        vad_available = vad is not None
        speech_segments = []
        if vad is not None:
            speech_segments = await asyncio.to_thread(vad.speech_segments, samples)
        else:
            log.warning("analysis_stage_degraded", stage=stage, reason="vad_model_missing")
        log.info(
            "analysis_stage_completed",
            stage=stage,
            duration_ms=_elapsed_ms(stage_started),
            speech_segment_count=len(speech_segments),
        )

        transcript: NormalizedTranscript | None = None
        if request.include_transcript:
            stage = "transcript"
            stage_started = time.perf_counter()
            transcript = await self._transcribe(samples, request, speech_segments)
            log.info(
                "analysis_stage_completed",
                stage=stage,
                duration_ms=_elapsed_ms(stage_started),
                transcript_segments=len(transcript.segments),
                transcript_words=sum(
                    len(s.words) or len(s.text.split()) for s in transcript.segments
                ),
            )

        transcript_text: str | None = None
        if transcript is not None:
            text = transcript.full_text()
            if text:
                transcript_text = text
        transcript_available = transcript is not None and transcript_text is not None
        rate: SpeechRateResult | None = None
        fillers: FillerResult | None = None
        disfluencies: DisfluencyResult | None = None
        if transcript is not None and transcript_available:
            rate = compute_speech_rate(
                transcript,
                speech_segments,
                self.settings.fast_wpm_threshold,
                self.settings.slow_wpm_threshold,
            )
            fillers = detect_fillers(transcript, self.settings.filler_words)
            disfluencies = detect_disfluencies(transcript)

        stage = "voice_features"
        stage_started = time.perf_counter()
        voice_series = None
        if vad_available and speech_segments:
            try:
                voice_series = await asyncio.to_thread(
                    extract_voice_series, samples, speech_segments
                )
            except Exception as exc:  # pitch/energy failure degrades the group
                log.warning("analysis_stage_failed", stage=stage, error=str(exc))
        log.info("analysis_stage_completed", stage=stage, duration_ms=_elapsed_ms(stage_started))

        events: dict[str, list[float]] = {}
        if fillers is not None:
            events["filler"] = [m.start for m in fillers.matches]
        if disfluencies is not None:
            events["repetition"] = disfluencies.repetition_times
            events["false_start"] = disfluencies.false_start_times
            events["self_correction"] = disfluencies.self_correction_times
        if vad_available:
            events["pause"] = [p.start for p in pauses_from_segments(speech_segments)]

        features = build_interview_features(
            session_id=request.session_id,
            question_id=request.question_id,
            media_kind=request.media_kind,
            records=records,
            group_failures=group_failures,
            speech_segments=speech_segments,
            duration_sec=metadata.duration_sec,
            analysis_fps=self.settings.video_analysis_fps,
            window_sec=self.settings.analysis_window_sec,
            width=metadata.width,
            height=metadata.height,
            source_fps=metadata.fps,
            rate=rate,
            fillers=fillers,
            disfluencies=disfluencies,
            voice_series=voice_series,
            vad_available=vad_available,
            transcript_available=transcript_available,
            audio_samples=samples,
            events=events,
        )

        stage = "persist"
        stage_started = time.perf_counter()
        prefix = f"analysis/{request.session_id}/{request.question_id or 'session'}"
        audio_artifact = {
            "speech_segments": [{"start": s.start, "end": s.end} for s in speech_segments],
            "pauses": [
                {"start": p.start, "end": p.end} for p in pauses_from_segments(speech_segments)
            ]
            if vad_available
            else [],
            "segment_wpms": [
                {"start": s.start, "end": s.end, "wpm": s.wpm} for s in rate.segment_wpms
            ]
            if rate is not None
            else [],
            "filler_matches": [
                {"phrase": m.phrase, "start": m.start, "end": m.end} for m in fillers.matches
            ]
            if fillers is not None
            else [],
        }
        objects = await self._persist_artifacts(
            request, transcript, records, audio_artifact, features
        )
        log.info(
            "analysis_stage_completed",
            stage=stage,
            duration_ms=_elapsed_ms(stage_started),
            artifacts=sorted(objects),
        )

        duration_ms = _elapsed_ms(started)
        log.info(
            "analysis_completed",
            duration_ms=duration_ms,
            media_duration=metadata.duration_sec,
            frames_processed=frames_processed,
            audio_duration_sec=audio_duration_sec,
            features_generated=count_measurements(features),
        )
        return AnalysisResponse(
            analysis_job_id=request.analysis_job_id,
            result=AnalysisResultRef(object_prefix=prefix, objects=objects),
            transcript_text=transcript_text,
            features=features,
            media=metadata,
            metrics=ProcessingMetrics(
                duration_ms=duration_ms,
                media_duration_sec=metadata.duration_sec,
                frames_processed=frames_processed,
                audio_duration_sec=audio_duration_sec,
                features_generated=count_measurements(features),
            ),
        )

    async def _transcribe(
        self,
        samples: npt.NDArray[np.float32],
        request: AnalysisRequest,
        speech_segments: list[SpeechSegment],
    ) -> NormalizedTranscript:
        """Transcribe via the STT port; STT failure fails the whole job."""
        adapter = self._stt_adapter()
        pcm_bytes = (samples * 32768.0).astype(np.int16).tobytes()
        try:
            with_timestamps = getattr(adapter, "transcribe_with_timestamps", None)
            if callable(with_timestamps):
                transcript = await with_timestamps(pcm_bytes, SAMPLE_RATE, request.language_hint)
                if isinstance(transcript, NormalizedTranscript):
                    return transcript
            fallback = await self._transcribe_via_stream(adapter, pcm_bytes, request)
            # Word timings estimated from VAD speech regions — approximate.
            return estimate_word_timings(fallback, speech_segments)
        except SttError:
            raise
        except Exception as exc:
            raise SttError(f"stt adapter failed: {exc}") from exc

    async def _transcribe_via_stream(
        self, adapter: SttPort, pcm_bytes: bytes, request: AnalysisRequest
    ) -> NormalizedTranscript:
        chunk_size = 4096

        async def _stream() -> AsyncIterator[bytes]:
            for i in range(0, len(pcm_bytes), chunk_size):
                yield pcm_bytes[i : i + chunk_size]
                await asyncio.sleep(0)

        final_text = ""
        async for event in adapter.transcribe_stream(
            _stream(), language_hint=request.language_hint
        ):
            if event.is_final:
                final_text = event.text
        if not final_text:
            return NormalizedTranscript(segments=[])
        return NormalizedTranscript(
            segments=[
                TranscriptSegment(
                    speaker="candidate",
                    start=0.0,
                    end=len(pcm_bytes) / (SAMPLE_RATE * 2),
                    text=final_text,
                    confidence=None,
                    words=[],
                )
            ]
        )

    async def _persist_artifacts(
        self,
        request: AnalysisRequest,
        transcript: NormalizedTranscript | None,
        records: list[FrameVisualRecord],
        audio_artifact: dict[str, object],
        features: InterviewFeatures,
    ) -> dict[str, str]:
        artifacts: dict[str, bytes] = {
            "audio_features": json.dumps(audio_artifact, indent=2).encode("utf-8"),
            "aggregated_features": features.model_dump_json(indent=2).encode("utf-8"),
        }
        if transcript is not None:
            artifacts["transcript"] = transcript.model_dump_json(indent=2).encode("utf-8")
        if records:
            artifacts["video_features"] = json.dumps([asdict(r) for r in records], indent=2).encode(
                "utf-8"
            )
        objects: dict[str, str] = {}
        for name, payload in artifacts.items():
            ref = await asyncio.to_thread(
                self.storage.upload_analysis_artifact,
                request.session_id,
                request.question_id,
                name,
                payload,
            )
            objects[name] = ref["objectName"]
        return objects


def _elapsed_ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000.0, 2)
