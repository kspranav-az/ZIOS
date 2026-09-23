# Phase 12c — Live-Path Re-validation, AI Wiring Audit, Ascend Chrome (goal plan)

**Companion to:** `phases/phase-12b-voice-practice-pdf.md` (merged `ddb0ff6`)
**Created:** 2026-09-23 · **Execution mode: thinking LOW — this file is the spec.**
**Branch:** `phase-12c/livepath-wiring-chrome` (cut from `main`), squash-forbidden, `--no-ff` merge, Conventional Commits via `git commit --no-verify -F /tmp/msg.txt`.

## Why this phase exists (evidence)

1. **Video interview never connected during manual validation** (2026-09-23). Root cause: the AI orchestrator is in the candidate live path — `VideoInterviewPage.tsx` only leaves "Starting your video interview…" when the WebSocket to the orchestrator (`/voice/sessions/:id/stream`) opens, and token issuance also routes through it. The orchestrator container was stopped (user runs it on host now: `uv run uvicorn app.main:app --reload --port 8000`).
2. **Host-run orchestrator has no env** — `uv run` does not load `.env`; without exports it signs LiveKit tokens with dev defaults (`ws://localhost:7880`/devkey) while the API now points browsers at LiveKit Cloud → guaranteed token mismatch; MinIO endpoint `minio:9000` is unresolvable on host.
3. **API container cannot reach a host-run orchestrator** — compose sets `ORCHESTRATOR_URL=http://ai-orchestrator:8000` (docker network).
4. **LiveKit Cloud credentials added to `.env`** (2026-09-23, `wss://zios-hckwyqlv.livekit.cloud`; old dev values commented out — compose `.env` parsing is last-wins but dotenv is first-wins, so duplicates must never exist).
5. **"Questions from JD not working" with gemini** — `.env` has `LLM_MODE=gemini`, a valid key, and `GEMINI_MODEL=gemini-3.1-flash-lite` (current model; the 1.5-flash default is NOT the cause). Failure is therefore elsewhere: key→container interpolation, prompt-schema parse, gateway routing, or frontend error swallowing. Must be isolated, not guessed.
6. **Ascend UI never took the reference chrome** — `AI-Interview-Platform/src/components/RecruiterLayout.jsx` (fixed left sidebar, nav items + active state, topbar) was never ported; `PageShell` is a bare header (logo + wallet chip). Tokens/BrandLogo ARE already faithful (hex-for-hex palette in `packages/ui/src/tokens.css`). AGENTS.md rule 4 requires copying the reference exactly.
7. **One failed analysis job** from the multimodal seed (Q2 30s clip → `failed` in ~10s under emulated amd64). Re-check now that the orchestrator runs native arm64.

**Global rules:** same as the Phase 12b plan (X8 consent, evidence-linked output only, provider independence behind ports, `--no-ff` merges, never squash, hermetic tests with `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos` inline, no direct commits to `main`).

**Test commands:** API `DATABASE_URL=… pnpm --filter @zios/api test`; ascend-web `pnpm --filter ascend-web test|e2e` (**rebuild the image before e2e** — playwright tests the image, not the tree); orchestrator `cd services/ai-orchestrator && uv run pytest`; ruff/mypy strict for orchestrator.

---

## Step 1 — Environment wiring (config only, no app code)

### 1.1 Host orchestrator env file
Create `services/ai-orchestrator/.env.host` (already covered by `.gitignore` line `.env.*` — verify with `git check-ignore`):

```bash
export LIVEKIT_URL=wss://zios-hckwyqlv.livekit.cloud
export LIVEKIT_API_KEY=APInngMUbpdHDvk
export LIVEKIT_API_SECRET=uEGDD6rmt5w1hBxrvgRV9HdFjCsx8aqyLJ7vf3yqZ4K
export MINIO_ENDPOINT=localhost:9000            # NOT minio:9000 — host network
export MINIO_ROOT_USER=<from repo .env>
export MINIO_ROOT_PASSWORD=<from repo .env>
export MINIO_BUCKET_MEDIA=<from repo .env>
export MINIO_SECURE=false
export STT_ADAPTER=mock
export DOCUMENT_EXTRACTION_ADAPTER=pypdf
export API_BASE_URL=http://localhost:3000
```

Do NOT put real secret values in this plan file — copy them from the repo-root `.env` at execution time. Start command: `cd services/ai-orchestrator && source .env.host && uv run uvicorn app.main:app --reload --port 8000`.

### 1.2 API → host orchestrator
Create repo-root `docker-compose.override.yml`:

```yaml
services:
  api:
    environment:
      ORCHESTRATOR_URL: http://host.docker.internal:8000
```

Add `docker-compose.override.yml` to `.gitignore` (it is host-specific; Linux CI would not have `host.docker.internal`). Then `docker compose up -d api`.

### 1.3 Keep the orchestrator container dead
`docker compose stop ai-orchestrator`. **Trap to document:** any bare `docker compose up -d` restarts it → port-8000 clash with the host process → confusing half-working failures. Verify after any compose up.

### 1.4 LiveKit Cloud into the live path
`docker compose up -d api` (picks up `LIVEKIT_URL` now pointing at cloud). The local `livekit` dev container stays up but unused — harmless.
**Gate:** `curl -s localhost:8000/healthz` (host orchestrator) → `{"status":"ok"}`; `curl -s localhost:3000/healthz` → ok; orchestrator `/documents/health/extraction` → pypdf.

---

## Step 2 — Live-path re-validation (no code expected; evidence only)

1. **Token wiring:** seed a voice/video validation interview, call the token endpoint, assert the response `livekit.url` is the cloud `wss://zios-hckwyqlv.livekit.cloud` (not `ws://localhost:7880`). If it still says localhost → api container did not pick up `.env` (recreate with `docker compose up -d --force-recreate api`).
2. **Video golden journey by hand:** `node scripts/seed-video-proctoring-validation.js` → candidate link → consent → preflight → room connects → conductor turn → snapshots → text fallback → complete → employer report shows integrity flags with evidence.
3. **Voice journey by hand:** `node scripts/seed-voice-validation.js` → room + TTS + STT fallback.
4. **Failed analysis job:** query `analysis_job` for the 2026-09-23 Q2 failure (`SELECT kind, status, error FROM analysis_job WHERE status='failed' ORDER BY created_at DESC LIMIT 5;` — adapt to real columns) → classify error → redrive if transient (`scripts/redrive-analysis-job.js`).
5. **Multimodal seed on native arm64:** re-run `node scripts/seed-multimodal-analysis-validation.js` — expect the 150s clip analysis in minutes (vs ~30 min emulated). Both jobs must complete schema-valid.
**Gate:** recording lands in MinIO (`recordings/*.webm`); analysis artifacts in `analysis/{sessionId}/…`; jobs `completed`.
**If video still fails:** capture browser console + orchestrator logs; do NOT proceed to Step 3 until the live path is green (everything downstream depends on it).

---

## Step 3 — AI wiring audit (the JD/gemini investigation)

### 3.1 Capture the real error (read-only)
- `docker compose logs -f api` in one terminal.
- Employer-web → kit builder → JD → Generate. Record the exact gateway log line (`LlmGateway` warnings include provider + task) and the HTTP status the UI receives.
- Also check `analyze_jd` and `draft_questions` prompt JSON exist in `services/api/prompts/` with fixtures the mock table accepts.

### 3.2 Isolation matrix — one variable at a time

| Run | Config | Proves |
|---|---|---|
| A | current (gemini, cloud key, gemini-3.1-flash-lite) | The reported failure, exact error captured |
| B | `LLM_MODE=mock` in `.env`, recreate api | UI + API + prompt-schema wiring are sound → failure is provider-side |
| C | back to gemini, `GEMINI_MODEL` bumped to the newest flash if A shows model-level errors | Whether provider response format drifted |

Each run: click Generate, note success/failure + logs. Run B must pass (mock fixtures are the demo configuration — non-negotiable).

### 3.3 Fix classes (choose based on evidence; smallest change wins)
- **Key interpolation:** `GEMINI_API_KEY` empty inside the container → verify `docker compose exec api printenv GEMINI_API_KEY | wc -c` (config fix only).
- **Provider response not parsing against our prompt schema** → tighten the prompt's JSON contract in the prompt JSON (versioned artifact: bump version dir, add fixture, contract test) and/or add one bounded repair retry in `GeminiLlmProvider`. Ships with an eval note per AGENTS.md §6.
- **UI swallows the error** → surface the gateway's message on the generation page (employer-web `pages/generation`), same pattern as other error lines in the app.
- **Routing:** `LlmGateway` must fail loudly (no silent mock fallback in gemini mode — provider independence, no fabricated output).

### 3.4 Wiring matrix deliverable
New doc `docs/ai-wiring-matrix.md`: every AI surface on one page — task name → module → provider + env var → frontend entry point → error path → how verified → status. Rows: `analyze_jd`, `draft_questions`, `resume_parse`, `ats_readiness_check`, `resume_jd_match`, `coaching-tips`, judge ensemble (evaluation), STT (`STT_ADAPTER` mock/gcp), TTS, practice JD kit, async-video transcription, document extraction. This is the permanent artifact so this bug class can't hide again.
**Gate:** run B (mock) green end-to-end on every row's frontend path (JD propose → regenerate → publish; Ascend: JD mock, resume parse/ATS/match, coaching tips; voice/video conductor TTS + STT fallback); run A either green or its failure precisely classified with a filed fix.

---

## Step 4 — Ascend chrome port (code, one concern)

1. Read `AI-Interview-Platform/src/components/RecruiterLayout.jsx` fully. Port 1:1 to `apps/ascend-web/src/components/AscendLayout.tsx` (typed TSX, tokens from `@zios/ui` — do NOT copy the Tailwind CDN config, the palette already exists in `tokens.css`). Sidebar nav: **Home `/`, Practice `/practice`, Progress `/progress`, Resume `/resume`, Wallet `/wallet`** with icon + label + active-route state; BrandLogo section; logout; wallet chip moves to the topbar.
2. Wire as the layout route in `apps/ascend-web/src/App.tsx` under `RequireAuth` via `<Outlet />`. **Immersive exceptions (no chrome):** `/login`, `/onboarding`, `/practice/:sessionId/interview`, `/practice/:sessionId/consent` (focused flows — matches reference behavior).
3. Match the reference's mobile pattern from `CandidateLayout.jsx`/`Navbar.jsx` (sidebar collapse or bottom nav — copy, don't invent). Ascend is mobile-first per PRD.
4. Update shell-touching unit tests (any query against the old header/shell) and add one AscendLayout test (nav renders, active state, logout). Delete nothing in `PageShell` until the layout is proven — keep it for immersive pages, or extract a shared minimal header; smallest diff wins.
5. `docker compose build ascend-web && docker compose up -d ascend-web` then `pnpm --filter ascend-web test` + full `pnpm --filter ascend-web e2e`.
**Gate:** 4/4 existing e2e green + new layout test green; visual check against the reference screenshots/side-by-side.

---

## Step 5 — Docs close-out + merge

- `CONTEXT.md` gotchas: host-orchestrator workflow (`.env.host` + `source`), `.env` duplicate-variable hazard (compose last-wins vs dotenv first-wins), port-8000 clash trap, LiveKit Cloud switch (dev server now fallback), "verify `livekit.url` in token responses points at cloud" as a standing check.
- `docs/manual-validation-checklist.md`: add token-URL row + "run the Step 3.2 matrix before any demo using gemini" row.
- `docs/STATE.md`: infra row updated (orchestrator runs native on host for dev; cloud LiveKit in use); gap rows updated from Step 2 evidence.
- This file: tick all gates with evidence. **No new phase tag** — follow-up on top of `phase-12-complete` + 12b, same as 12b.
- `git push origin main phase-12c/livepath-wiring-chrome`.

## Commits (suggested sequence)
1. `chore(dev): host-orchestrator env template + compose override + gitignore` (non-secret files only — `.env.host` stays local)
2. `fix(ascend): port reference sidebar layout (AscendLayout)` (+tests)
3. `fix(generation|llm-gateway): <what Step 3 evidence shows>` (only if a code fix is needed)
4. `docs: ai wiring matrix + CONTEXT/STATE/checklist updates`
