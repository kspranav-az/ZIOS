# AI Wiring Matrix (single page of truth)

Every AI surface in the system: what calls it, which provider answers, how it
fails, and how it was verified. Maintained under Phase 12c; update when a task,
adapter, or env var changes. The bug class this exists to prevent: **a surface
silently answering with fabricated output while a real provider is configured**
(root cause of the "Questions from JD not working" incident — see
`phases/phase-12c-livepath-ai-wiring-chrome.md` Step 3).

## Gateway tasks (NestJS `services/api`, LlmGateway)

Provider selection is env-driven: `LLM_MODE=mock` registers only the mock
provider; `LLM_MODE=gemini` + `GEMINI_API_KEY` registers mock **and** gemini.
Since the 12c routing fix, a provider marked `fabricated` (the mock) is never
selected implicitly while a real provider is registered — gemini failures
surface as `503 LLM_UNAVAILABLE`, not silent fixture output.

| Task | Module / caller | Provider + env | Frontend entry | Error path | Verified | Status |
|---|---|---|---|---|---|---|
| `analyze_jd` | generation → `LlmGenerationAdapter` | gemini (`GEMINI_MODEL`, default `gemini-3.5-flash-lite`) / mock fixture | employer-web kit builder → `generationApi.analyze` | 503 `LLM_UNAVAILABLE`, 502 `LLM_PROVIDER_ERROR`/`LLM_INVALID_JSON`/`LLM_OUTPUT_VALIDATION`, 400 `GUARDRAIL_BLOCKED` — surfaced on generation page | Live run A (gemini, real profile returned) + run B (mock fixture) both 201; unit + contract suites green | ✅ fixed + verified |
| `draft_questions` | generation → `LlmGenerationAdapter` | same as above | employer-web propose / regenerate | same as above | Same runs (propose calls `draft_questions` per topic); suites green | ✅ fixed + verified |
| `conductor_next_turn` | sessions → `LlmConductorAdapter` (voice interview follow-ups) | same as above | candidate-web voice interview (via orchestrator conductor) | same as above; no silent mock fallback in gemini mode | Unit suites; candidate voice e2e green (Step 2) | ✅ wiring verified (live gemini turn optional) |
| `judge_score` / `judge_adjudicate` | evaluation → `JudgeEnsembleAdapter` | same as above | employer-web report pages (post-session scoring) | same as above; evidence-linked scoring enforced at schema layer | Unit suites; evaluation e2e green | ✅ wiring verified |
| `resume_parse` | resume module | same as above | ascend-web Resume page → `POST /cand/resume` | same as above | Unit suites; ascend e2e (Step 4 gate) | ✅ wiring verified |
| `ats_readiness_check` | resume module | same as above | ascend-web Resume/Progress → `/cand/practice/readiness` | same as above | Unit suites; ascend e2e | ✅ wiring verified |
| `resume_jd_match` | resume module | same as above | ascend-web Resume → `POST /cand/resume/match` | same as above | Unit suites; ascend e2e | ✅ wiring verified |
| `coaching_tips` | practice-evaluation | same as above | ascend-web Practice report | same as above | Unit suites; ascend e2e | ✅ wiring verified |
| `practice_kit_from_jd` | practice service | same as above | ascend-web Practice setup → `POST /cand/practice/from-jd` | same as above | Unit suites; ascend e2e | ✅ wiring verified |

Prompt artifacts: `services/api/prompts/<task>/vX.Y.Z.json` (template,
variablesSchema, outputSchema, defaultPolicy, providerOverrides). All tasks
above resolve against the registry; the mock fixture table throws on unknown
tasks, so a new task needs prompt + fixture + contract test together.

## Orchestrator adapters (Python `services/ai-orchestrator`)

| Surface | Port / selection | Env | Caller / frontend path | Verified | Status |
|---|---|---|---|---|---|
| STT (async-video transcription) | `app/analysis/stt/factory.py` | `STT_ADAPTER` = `mock` (`.env.host`) / `gcp` | api enqueues analysis jobs after async-video upload; candidate-web async interview | Multimodal seed passed end-to-end (2/2 jobs, mock STT) | ✅ mock verified; **gcp adapter unvalidated (known gap)** |
| Document extraction | `app/documents/service.py` | `DOCUMENT_EXTRACTION_ADAPTER` = `pypdf` (`.env.host`) | resume upload parsing path | pypdf extraction exercised via seed/e2e | ✅ verified (pypdf); `mock` also available |
| TTS (voice practice conductor) | `MockTtsAdapter` hardcoded in `app/voice/router.py` | none — **no env switch yet** | candidate-web / ascend-web voice practice turns | Voice e2e green with mock TTS | ⚠️ mock-only by code; real TTS adapter deferred (recorded known gap) |

## Standing checks (run before any demo)

1. `docker compose exec api printenv LLM_MODE GEMINI_MODEL` — mode is what you think it is.
2. With `LLM_MODE=gemini`: `POST /generation/analyze` must return in >~300 ms with an AI-shaped profile (no `raw.titleSource` marker = real provider; ~34 ms + `raw.*` = mock — that means routing regressed).
3. E2E and CI-style runs use `LLM_MODE=mock` (hermetic, deterministic). Gemini mode is for manual validation only.
