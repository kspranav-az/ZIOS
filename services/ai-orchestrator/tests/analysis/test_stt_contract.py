"""SttPort contract suite: MockSttAdapter AND GoogleCloudSttAdapter.

The GCP adapter runs with a fully fake SpeechClient — no credentials, no
network. The suite passes with STT_ADAPTER=mock and no GCP env set.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.analysis.errors import SttError
from app.analysis.stt.gcp import GoogleCloudSttAdapter
from app.analysis.transcript_schema import NormalizedTranscript
from app.voice.mock_stt import MockSttAdapter
from app.voice.ports import SttPort


def _fake_recognize_response() -> Any:
    from google.cloud.speech_v2.types import (
        RecognizeResponse,
        SpeechRecognitionAlternative,
        SpeechRecognitionResult,
        WordInfo,
    )
    from google.protobuf.duration_pb2 import Duration

    return RecognizeResponse(
        results=[
            SpeechRecognitionResult(
                alternatives=[
                    SpeechRecognitionAlternative(
                        transcript="Hello world",
                        confidence=0.9,
                        words=[
                            WordInfo(
                                word="Hello",
                                start_offset=Duration(seconds=0),
                                end_offset=Duration(seconds=0, nanos=500_000_000),
                            ),
                            WordInfo(
                                word="world",
                                start_offset=Duration(seconds=0, nanos=600_000_000),
                                end_offset=Duration(seconds=1),
                            ),
                        ],
                    )
                ]
            )
        ]
    )


class _FakeSpeechClient:
    """Duck-typed stand-in for google.cloud.speech_v2.SpeechClient."""

    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self._response = response if response is not None else _fake_recognize_response()
        self._error = error
        self.requests: list[Any] = []

    def recognize(self, request: Any) -> Any:
        self.requests.append(request)
        if self._error is not None:
            raise self._error
        return self._response


def _gcp_adapter() -> GoogleCloudSttAdapter:
    return GoogleCloudSttAdapter(project_id="test-project", client=_FakeSpeechClient())


def _adapters() -> list[SttPort]:
    return [MockSttAdapter(fixture="short"), _gcp_adapter()]


async def _pcm_stream(n_chunks: int = 4) -> AsyncIterator[bytes]:
    for _ in range(n_chunks):
        yield b"\x00\x01" * 160


@pytest.mark.parametrize("adapter", _adapters(), ids=["mock", "gcp"])
@pytest.mark.asyncio
async def test_contract_emits_exactly_one_final_event(adapter: SttPort) -> None:
    events = [e async for e in adapter.transcribe_stream(_pcm_stream())]
    finals = [e for e in events if e.is_final]
    assert len(finals) == 1
    assert finals[-1].type == "final"
    assert events[-1].is_final


@pytest.mark.parametrize("adapter", _adapters(), ids=["mock", "gcp"])
@pytest.mark.asyncio
async def test_contract_final_text_non_empty(adapter: SttPort) -> None:
    events = [e async for e in adapter.transcribe_stream(_pcm_stream())]
    assert events[-1].text.strip()


@pytest.mark.parametrize("adapter", _adapters(), ids=["mock", "gcp"])
@pytest.mark.asyncio
async def test_contract_healthcheck_reports_status(adapter: SttPort) -> None:
    health = await adapter.healthcheck()
    assert "status" in health


@pytest.mark.asyncio
async def test_gcp_word_timings_normalized() -> None:
    adapter = _gcp_adapter()
    transcript = await adapter.transcribe_with_timestamps(b"\x00" * 320, 16000)
    assert isinstance(transcript, NormalizedTranscript)
    assert transcript.full_text() == "Hello world"
    segment = transcript.segments[0]
    assert segment.speaker == "candidate"
    assert segment.start == 0.0
    assert segment.end == 1.0
    assert [w.text for w in segment.words] == ["Hello", "world"]
    assert segment.words[1].start == 0.6
    assert segment.confidence == pytest.approx(0.9, abs=1e-4)


@pytest.mark.asyncio
async def test_gcp_recognize_failure_raises_stt_error() -> None:
    adapter = GoogleCloudSttAdapter(
        project_id="test-project",
        client=_FakeSpeechClient(error=RuntimeError("quota exceeded")),
    )
    with pytest.raises(SttError, match="quota exceeded"):
        await adapter.transcribe_with_timestamps(b"\x00" * 320, 16000)


def test_gcp_missing_project_id_fails_loudly() -> None:
    with pytest.raises(SttError, match="GCP_PROJECT_ID"):
        GoogleCloudSttAdapter(project_id=None, client=_FakeSpeechClient())


def test_gcp_uses_language_hint_and_config() -> None:
    client = _FakeSpeechClient()
    adapter = GoogleCloudSttAdapter(
        project_id="test-project",
        location="us",
        config={"model": "chirp_2"},
        client=client,
    )
    import asyncio

    asyncio.run(adapter.transcribe_with_timestamps(b"\x00" * 320, 16000, "en-IN"))
    request = client.requests[0]
    assert list(request.config.language_codes) == ["en-IN"]
    assert request.config.model == "chirp_2"
    assert request.config.features.enable_word_time_offsets is True
    assert "projects/test-project/locations/us/recognizers/_" == request.recognizer


def test_factory_builds_mock_by_default() -> None:
    from app.analysis.config import load_settings
    from app.analysis.stt.factory import build_stt_adapter

    adapter = build_stt_adapter(load_settings({"STT_ADAPTER": "mock"}))
    assert isinstance(adapter, MockSttAdapter)


def test_factory_unknown_adapter_raises() -> None:
    from app.analysis.config import load_settings
    from app.analysis.stt.factory import build_stt_adapter

    with pytest.raises(ValueError, match="unknown STT_ADAPTER"):
        build_stt_adapter(load_settings({"STT_ADAPTER": "bogus"}))


def test_factory_gcp_requires_project_id() -> None:
    from app.analysis.config import load_settings
    from app.analysis.stt.factory import build_stt_adapter

    with pytest.raises(SttError, match="GCP_PROJECT_ID"):
        build_stt_adapter(load_settings({"STT_ADAPTER": "gcp"}))
