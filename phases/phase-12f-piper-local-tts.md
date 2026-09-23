# Phase 12f — Piper Local TTS Behind `TTS_ADAPTER` (goal plan)

**Companion to:** `phases/phase-12e-practice-live-history-responsive.md` (merged `5a5d6f1`) · `fix/voice-telemetry-serialization` (merged `c51fed2`)
**Created:** 2026-09-24 · **Execution mode: thinking LOW — this file is the spec.**
**Branch:** `phase-12f/piper-local-tts` (cut from `main`), squash-forbidden, `--no-ff` merge, Conventional Commits via `git commit --no-verify -F /tmp/msg.txt`.
**Scope: TTS only.** Do NOT touch STT in this phase (see Step 6 note).

## Why this phase exists (evidence)

1. TTS is the last all-mock piece of the live voice/video/practice room: `app/voice/router.py:85-86` hardcodes `MockSttAdapter()` + `MockTtsAdapter()`. The gemini smoke of the practice room (2026-09-24) produced unintelligible synthetic audio (the "high-pitched sound").
2. Piper (VITS via ONNX Runtime, espeak-ng phonemization) runs faster-than-realtime on CPU, needs no API key, ships amd64 wheels for the orchestrator image, and arm64 wheels for the Mac dev loop. en_US-lessac voices are MIT-licensed.
3. The port exists: `TtsPort.synthesize_stream` in `app/voice/ports.py`. The wire contract is raw PCM16 mono hex at **24000 Hz** (`packages/interview-room/src/tts-audio.ts` hardcodes 24000; mock emits 24000 in `app/voice/mock_tts.py`). Piper medium outputs 22050 Hz → the adapter resamples to 24000 so the wire contract and ALL frontend code stay untouched.

**Global rules:** provider independence — vendor name appears only in env var values and the adapter filename/class (precedent: `STT_ADAPTER=mock|gcp`, `DOCUMENT_EXTRACTION_ADAPTER`); no auto-reject paths; no direct commits to `main`; commits via `git commit --no-verify -F /tmp/msg.txt`; hermetic tests must pass with `TTS_ADAPTER` unset (mock default) and without the model file present; **never commit model files** (add `services/ai-orchestrator/models/` to `.gitignore`).

**Test commands:** orchestrator `cd services/ai-orchestrator && uv run pytest` (+ `uv run ruff check app tests` + `uv run mypy`); TS typecheck only if a `.ts` file changes (should be none).

**Traps carried from CONTEXT.md:** the orchestrator image is linux/amd64-emulated on this Mac — `docker compose build ai-orchestrator` exceeds a 5-minute tool cap: build detached (`nohup … > /tmp/build.log 2>&1 &`) and poll the log; after ANY build, verify the fix landed in the image before testing. Host orchestrator on port 8000 must be started with `--reload` from `services/ai-orchestrator/.env.host` — check `lsof -nP -iTCP:8000` first. `.env` duplicate-key hazard: comment out the old value when adding a new key.

---

## Step 1 — Branch + dependency + dev model

1. `git checkout main && git pull --ff-only origin main` (main is at the telemetry fix `c51fed2`) then `git checkout -b phase-12f/piper-local-tts`.
2. Add the dependency: in `services/ai-orchestrator/pyproject.toml` add `piper-tts>=1.3` to dependencies, then `uv sync` (onnxruntime is already present via Silero VAD — if piper pins a conflicting onnxruntime, keep the existing lower bound working and record the resolved version in the commit body).
3. Verify `uv run python -c "import soxr"` succeeds (soxr is a librosa dependency used for resampling). If it fails, add `soxr>=0.5` to pyproject and `uv sync` again.
4. Download the dev model (do exactly this, from `services/ai-orchestrator/`):
   ```bash
   mkdir -p models && cd models
   curl -fsSL -O https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx
   curl -fsSL -O https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
   shasum -a 256 en_US-lessac-medium.onnx   # record the hash — it goes in the Dockerfile + .gitignore'd README note
   ```
5. Add `services/ai-orchestrator/models/` to the repo-root `.gitignore`.

✅ **Gate:** `uv run python -c "from piper.voice import PiperVoice; v=PiperVoice.load('models/en_US-lessac-medium.onnx'); print(v.config.sample_rate)"` prints a sample rate (expected 22050). `uv run pytest -q` still green (nothing wired yet).

---

## Step 2 — `PiperTtsAdapter` + factory

### 2.1 `services/ai-orchestrator/app/voice/piper_tts.py`
`class PiperTtsAdapter(TtsPort)` with EXACTLY the sentence-buffering semantics of `MockTtsAdapter` (reuse the same `SENTENCE_RE` — import it from `app.voice.mock_tts`):

- `__init__(model_path: str | None = None)` — path = arg → env `PIPER_MODEL_PATH` → default `<repo>/services/ai-orchestrator/models/en_US-lessac-medium.onnx` resolved via `Path(__file__).resolve().parents[3] / "models" / "en_US-lessac-medium.onnx"`. Missing file → `FileNotFoundError` with the expected path in the message (fail loudly at construction, not mid-turn). Load `PiperVoice.load(path)` once in `__init__`; read the output rate from `voice.config.sample_rate`.
- `synthesize_stream(text_stream, language_hint=None, voice_id=None)`: buffer fragments → split sentences with `SENTENCE_RE` (same loop shape as the mock) → per sentence, `for pcm in self._voice.synthesize_stream_raw(sentence)` collecting int16 mono bytes → resample the full sentence PCM to **24000 Hz** with soxr (`soxr.resample(np.frombuffer(pcm, dtype=np.int16).astype(np.float32)/32768.0, in_rate, 24000)` then back to int16) → yield `TtsChunk(audio_bytes=<resampled PCM16>, text=sentence, is_final=False)`. Flush the trailing fragment (no terminal punctuation) as the final chunk with `is_final=True`, same as the mock. Piper is sync/blocking — run synthesis with `asyncio.to_thread` so the event loop is not blocked, and `await asyncio.sleep(0)` between yields.
- `healthcheck()` → `{"status": "healthy"|"unhealthy", "provider": "piper", "model": <path>, "sample_rate": 24000, "source_sample_rate": <model rate>}`.

### 2.2 `services/ai-orchestrator/app/voice/tts_factory.py`
Mirror `app/analysis/stt/factory.py`:

```python
def build_tts_adapter() -> TtsPort:
    name = os.environ.get("TTS_ADAPTER", "mock").strip().lower() or "mock"
    if name == "mock": return MockTtsAdapter()
    if name == "piper": return PiperTtsAdapter()
    raise ValueError(f"unknown TTS_ADAPTER {name!r}; expected one of: mock, piper")
```
Log the selection with structlog (`tts_adapter_selected`).

### 2.3 Wire the router
In `app/voice/router.py`: module level `_tts_adapter: TtsPort = build_tts_adapter()` (boot-time fail-loud on a bad env value, before any request). Replace `tts=MockTtsAdapter()` in `issue_voice_token` with `tts=_tts_adapter`. Do NOT touch the `MockSttAdapter()` line — STT is out of scope.

✅ **Gate:** `TTS_ADAPTER` unset → `uv run pytest -q` fully green (mock path unchanged). New `tests/test_piper_tts.py` (below) green with the model present.

---

## Step 3 — Tests (`services/ai-orchestrator/tests/test_piper_tts.py`)

`piper = pytest.importorskip("piper")` at module top; `_MODEL` = the default path from 2.1; `pytestmark = pytest.mark.skipif(not _MODEL.exists(), reason="piper model not downloaded")` — CI without the model still passes everything else.

1. `test_piper_tts_contract_chunks_and_text` — mirror `test_mock_tts_emits_chunks_for_text`: stream `["Hello", "world."]`, assert ≥1 chunk, all `audio_bytes` non-empty and even-length (PCM16), joined text contains both words.
2. `test_piper_tts_outputs_pcm16_mono_24khz` — synthesize one short sentence; decode with `numpy.frombuffer(chunk.audio_bytes, dtype=np.int16)`; assert no exception, ≥ 4000 samples (≈ ≥0.16 s at 24 kHz — a real sentence can't be shorter), and the signal is NOT silence (`np.abs(samples).max() > 100`).
3. `test_piper_tts_flushes_trailing_fragment_final` — stream a single fragment with no punctuation (`["tell me more"]`), assert exactly one chunk with `is_final=True`.
4. `test_piper_tts_healthcheck` — provider `piper`, `sample_rate == 24000`, `source_sample_rate == 22050`.
5. `test_tts_factory_defaults_mock_and_rejects_unknown` — monkeypatch env: unset → `MockTtsAdapter`; `TTS_ADAPTER=piper` + monkeypatched model path → `PiperTtsAdapter`; `TTS_ADAPTER=bogus` → `ValueError`. (Factory tests must not require the real model — monkeypatch `PIPER_MODEL_PATH` for the piper case using the downloaded dev model, skipif absent.)
6. Keep them fast: total added runtime < 15 s on this machine.

✅ **Gate:** `uv run pytest -q` → full suite green (previous 123 passed / 2 skipped + new tests); `uv run ruff check app tests` clean; `uv run mypy` strict clean.

---

## Step 4 — Dockerfile (parity: bake espeak-ng + pinned model)

In `services/ai-orchestrator/Dockerfile`:

1. In the `apt-get install` runtime line (currently `ffmpeg libgl1 libglib2.0-0`), add `espeak-ng` (phonemizer dependency; no extra config needed).
2. Add `piper-tts` to the image's pip install step (same line block as the other requirements — the image installs from pyproject/requirements, confirm which mechanism the Dockerfile uses and follow it).
3. Extend the existing sha256-verified model-bake stage (the one that downloads `.task`/`.onnx` files) with the two Piper files from `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/`, verifying against the sha256 recorded in Step 1.4 (`shasum -a 256`). Copy them into `/opt/piper-models/` and set `ENV PIPER_MODEL_PATH=/opt/piper-models/en_US-lessac-medium.onnx` (and `ESPEAK_DATA_PATH` is NOT needed — espeak-ng defaults suffice; do not add speculative env).

✅ **Gate (detached build — the emulated amd64 build exceeds the 5-min tool cap):**
```bash
nohup docker compose build ai-orchestrator > /tmp/piper-build.log 2>&1 &
# poll: tail -f /tmp/piper-build.log — wait for " DONE" on the final export step
```
Then the parity probe:
```bash
docker compose run --rm -e TTS_ADAPTER=piper ai-orchestrator \
  python -c "from app.voice.tts_factory import build_tts_adapter; print(build_tts_adapter().healthcheck())"
```
Must print `{'status': 'healthy', 'provider': 'piper', 'sample_rate': 24000, ...}`. If the build fails, fix and rebuild — never test a stale image.

---

## Step 5 — Live verification (host orchestrator, real audio)

1. Kill any port-8000 process (`lsof -nP -iTCP:8000 -sTCP:LISTEN`) and start fresh with reload: `cd services/ai-orchestrator && set -a && source .env.host && TTS_ADAPTER=piper uv run uvicorn app.main:app --reload --port 8000` (run detached with nohup + log to `/tmp/zios-orchestrator.log` if a foreground run would block).
2. Also append `TTS_ADAPTER=piper` and `PIPER_MODEL_PATH=models/en_US-lessac-medium.onnx` to `services/ai-orchestrator/.env.host` so the standard dev loop picks it up (comment out any old value first — no duplicate keys).
3. Direct adapter probe (no browser needed):
   ```bash
   cd services/ai-orchestrator && TTS_ADAPTER=piper uv run python - <<'PY'
   import asyncio, numpy as np
   from app.voice.tts_factory import build_tts_adapter
   async def words():
       for w in "This is a real Piper voice check.".split(): yield w + " "
   async def main():
       chunks = [c async for c in build_tts_adapter().synthesize_stream(words())]
       pcm = np.frombuffer(b"".join(c.audio_bytes for c in chunks), dtype=np.int16)
       print(f"chunks={len(chunks)} samples={len(pcm)} peak={np.abs(pcm).max()} seconds={len(pcm)/24000:.2f}")
   asyncio.run(main())
   ```
   Pass criteria: ≥1 chunk, peak amplitude > 100 (non-silence), duration 1.5–5 s. Save the output line as evidence.
4. If the compose orchestrator container is running from Step 4 probing, stop it so the host process owns port 8000 (`docker compose stop ai-orchestrator`).
5. Compose `.env` keeps **no `TTS_ADAPTER` key** (factory default mock) so CI/e2e stay hermetic — e2e never depends on real synthesis.

✅ **Gate:** probe output meets criteria; `uv run pytest -q` still fully green.

---

## Step 6 — Docs close-out + merge

- **CONTEXT.md:** (a) new gotcha: the voice room's STT/TTS were hardcoded mocks — 12f adds the `TTS_ADAPTER` factory for TTS; **the voice room STT still ignores `STT_ADAPTER`** (router still constructs `MockSttAdapter()` directly) — record this as a known gap, it explains why real speech was fixture-transcribed in the smoke; (b) gotcha: Piper output rate (22050) ≠ wire rate (24000) — adapter resamples with soxr, wire contract unchanged; (c) test-state table: orchestrator pytest count updated; feature status: TTS row moves from "mock-only by code" to `TTS_ADAPTER=mock|piper` (Piper validated, cloud TTS still a later procurement option).
- **docs/STATE.md:** new evidence section "Phase 12f — Piper local TTS"; mock-credential table TTS row updated (`TtsPort` → `MockTtsAdapter`/`PiperTtsAdapter`, real handover: Piper validated for low load; cloud neural TTS deferred); known-gaps: remove "TTS is mock-only by code", add the voice-room STT hardcoding row; §8 next steps unchanged otherwise.
- **Phase file:** tick every gate with evidence (commit hashes + probe output line).
- Push branch → `git checkout main && git merge --no-ff phase-12f/piper-local-tts` → push `main`. **No new phase tag** (follow-up convention).

## Commits (suggested sequence)

1. `feat(orchestrator): piper local TTS adapter behind TTS_ADAPTER` — adapter + factory + router wiring + tests + pyproject (+ `.gitignore` models dir). Body: contract decision (resample to 24 kHz, wire unchanged) + test counts.
2. `build(orchestrator): bake espeak-ng + pinned piper model into image` — Dockerfile with sha256 pins.
3. `chore(env): TTS_ADAPTER=piper in .env.host for host dev` — env file; compose default stays mock.
4. `docs: phase 12f close-out` — CONTEXT/STATE/phase-file ticks.
5. Merge commit `chore(merge): phase 12f — piper local TTS`.
