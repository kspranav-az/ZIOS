# Phase 12 (M2) Implementation Plan — Ascend Candidate App, Grant-Funded Beta

**Companion to:** `phases/phase-12-m2-outline.md` (scope, pre-conditions) · `phases/phase-11-notifications-hardening-pilot-gate.md` (runs in parallel — do NOT tag `v0.2.0-pilot` here; that tag comes after Phase 11) · **Created:** 2026-09-23
**Execution mode: thinking LOW — this file is the spec.** Follow it step by step; do not redesign. Where a choice is marked **CONFIRM**, the default is already decided; only deviate if the owner explicitly overrides in writing.

**Pre-flight (once):** `docker compose up -d` and `pnpm migrate`. Postgres is on **55432** (root `.env` is stale — always use the 55432 URL inline). Read `CONTEXT.md` §7 gotchas before touching tests.

**Monetization deviation (recorded, locked):** Blueprint §20.3's ₹399/mo freemium is replaced by the **credit-grant model** — new candidate accounts get an admin-configurable welcome grant, support tops up via script; Razorpay credit top-up lands later (Phase 11 work) and will serve both products. Willingness-to-pay signal = future credit purchases. This deviation is recorded here and must be reflected in `docs/STATE.md` at close-out.

**Pilot-gate exception (recorded, locked):** phase-12-m2-outline.md pre-conditions (pilot gate, COGS proof) remain formally open. Ascend ships as a **closed, invite-only, grant-funded, transactional-email-only beta**. Do not add WhatsApp/SMS, marketing nudges, or payments in this phase.

---

## Global rules (from AGENTS.md + Phase-10 lessons — never trade away)

1. **Consent before capture (X8):** no media is processed without a stored `practice_consent` artifact, 100% of sessions. The practice preflight must refuse to go live without it.
2. **Evidence-linked coaching:** every coaching tip and readiness component cites observable metrics/transcript spans. **Never emotion/personality/face inference** — pace, fillers, pauses, structure, STAR completeness only. This is law-sensitive (EU AI Act) — a tip must say "you spoke 22% faster under follow-ups", never "you seemed nervous".
3. **Consent wall:** practice data never appears in any employer-tenant read path. Employer JWTs must get 403 on every `/practice/*` route (test this explicitly).
4. **Provider independence:** no vendor names in feature code; LLM tasks behind the gateway with versioned prompts (`services/api/prompts/<task>/vX.Y.Z.json`) + mock fixture + contract test. Any new LLM task ships with an eval note.
5. **Git:** no direct commits to `main`; branch per section below; Conventional Commits, imperative, **lowercase subject**, body references FR/AS IDs; `git commit --no-verify -F /tmp/msg.txt` (heredocs break in nested quoting); merge with `git merge --no-ff <branch> -m "merge: ..." --no-verify` (commitlint rejects `merge:` type); **never squash**.
6. **Tests hermetic:** integration specs isolate BullMQ queues (per-boot UUID env vars in `bootApp` — copy the pattern in `src/testing/integration/helpers.ts`), `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos` inline everywhere. `org` has **no `updated_at`** — never reference it in SQL.
7. **Welcome grants keep tests solvent:** candidate accounts get a welcome grant at signup — balance-zero tests must drain via SQL helper (copy `setBalance` from `credits-wallet.integration.spec.ts`).
8. **New-app test setup:** `apps/ascend-web` vitest setup MUST include the `Request`-signal wrapper (copy `apps/candidate-web/src/test/setup.ts`) or data-router navigation tests silently never navigate.
9. **E2E tests the image:** after any Ascend UI change, rebuild `docker compose build ascend-web && up -d` before `pnpm e2e`, or you test a stale bundle. Add the `ascend-web` compose service in Branch 3.
10. **No Agent subagents; no new third-party integrations** (email-only notifications; LLM = existing gateway mock).
11. `scripts/grant-credits.js`, `scripts/seed-*.js` patterns: copy structure from `scripts/seed-integration-sandbox.js`; DB access via `scripts/lib/local-db-client.js` with the 55432 URL.

Test commands:

- API: `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos pnpm --filter @zios/api test` (+ `lint`, `typecheck`)
- ascend-web: `pnpm --filter ascend-web test` / `lint` / `typecheck` / `e2e`
- Existing suites must stay green at every branch gate.

---

## Locked decision log (D1–D12)

| # | Decision | Locked default | CONFIRM? |
|---|----------|----------------|----------|
| D1 | Wallet principal model | **B — new `credit_account` table** (`holder_type 'org'\|'candidate'`, `holder_id`, unique together); ledger gains `account_id`; expand-migrate-contract | — |
| D2 | `org.credits_balance` fate | Keep as synced cache during migration; all writes go through the generalized service and update both; a later phase retires it | yes |
| D3 | Wallet config (`low_balance_threshold`) | Moves to `credit_account`; employer `GET /credits/wallet` contract unchanged (controller maps from account) | yes |
| D4 | Practice pricing | Reuse kinds `text`/`voice` at current prices (1/2). No `practice_*` kinds unless owner overrides | **CONFIRM** |
| D5 | Practice session storage | Own tables (`practice_session`, `practice_transcript`, `practice_consent`, `practice_report`) in a `practice` bounded context; **no reuse of `interview_session`** — the wall is enforced by construction, not flags | yes |
| D6 | Practice kit/snapshot | Inline `snapshot jsonb` on `practice_session` (questions + rubric lines), generated by a new LLM task — practice never writes employer `kit`/`kit_version` tables | — |
| D7 | Candidate login | Email OTP first (reuse `otp_code` flow with an `audience` discriminator; SMS deferred to Phase 11) | yes |
| D8 | Auth separation | Separate JWT audience `candidate` + `CandidateAuthGuard`; employer and candidate tokens never cross-validate | — |
| D9 | Evaluation reuse | Factor the evaluation write/read model so judges + report rendering run against `practice_transcript` → `practice_report` (separate table, same schema shape). Copy the scorecard-v1 factoring pattern from Phase 10 | — |
| D10 | Resume storage | MinIO bucket key `resumes/{accountId}/{uuid}` + `candidate_resume` row (parsed jsonb, ats report jsonb); deleted on account erasure | yes |
| D11 | COGS guardrails (beta) | Per-account daily cap (default 3 completed mocks/day, constant in code) + weekly manual `credit_ledger` review; no §20.4 automation yet | **CONFIRM** |
| D12 | Ascend app | New `apps/ascend-web` (Vite + React, TS strict, `.tsx` only, `packages/ui` + `shared-types`), PWA manifest + shell-cache SW, dev port **5175** | yes |

---

## Branch 0 — `phase-12/wallet-accounts` (2–3 days) — wallet generalization (D1–D3)

The only refactor that touches proven Phase-10 code. Small, careful, fully re-tested.

**Step 1 — Migration `infra/migrations/migrations/<ts>_credit-account.js`** (sibling style):
- `credit_account`: `id uuid pk`, `holder_type text not null check (holder_type in ('org','candidate'))`, `holder_id uuid not null`, `balance int not null default 0`, `low_balance_threshold int not null default 5`, `created_at timestamptz not null default now()`, `unique(holder_type, holder_id)`.
- `credit_ledger`: add `account_id uuid` (nullable first), backfill by creating one `credit_account` per existing `org` (`holder_type='org'`, `balance = org.credits_balance`, threshold copied from `org.low_balance_threshold`), then `alter column account_id set not null`. **Keep `org_id` and `org.credits_balance`** (cache — D2).
- Apply with `DATABASE_URL=... pnpm migrate`; verify row counts match orgs.

**Step 2 — Generalize `services/api/src/modules/credits/`.**
- `CreditsService`: every method takes `accountId` instead of `orgId` (`getBalance`, `adjustCredits`, `debit`, `credit`, `listLedger`, `hasRefundForSession`). Add `ensureAccount(holderType, holderId, q)` (insert-if-absent, returns id) — **every wallet mutation runs inside the caller's transaction and resolves the account first**.
- Org-facing wrapper: `forOrg(orgId)` helper resolving `('org', orgId)` so `sessions.service.ts`, `voice.service.ts`, `async-video-interviews.service.ts` call sites change one line each.
- `CreditsAlertService`: takes account; resolves alert emails by holder type — org → org admins (existing query); candidate → the candidate's email. Watermark key `lowbal:{accountId}` unchanged.
- `OrgRepository.setLowBalanceThreshold` → delegates to account row; employer Wallet controller/service reads threshold via account. Web contract unchanged.

**Step 3 — Tests.**
- All existing suites green unchanged (behavior identical — this is the proof).
- New integration spec `wallet-accounts.integration.spec.ts` (UUID queue isolation): org debit/credit/ledger/refund flows still exact; `ensureAccount` idempotent under concurrency (two parallel signups → one account); org threshold PATCH still works; low-balance alert still fires for org admins.

**Gate:** full API suite green + lint/typecheck. Tick nothing in the outline yet (pre-condition audit completes in Branch 2).

---

## Branch 1 — `phase-12/candidate-accounts` (3–4 days) — accounts, auth, onboarding

**Step 1 — Migrations:** `candidate_account` (`id uuid pk`, `email citext not null unique`, `phone text unique` (nullable), `name text not null`, `target_role text`, `onboarding jsonb not null default '{}'`, `marketing_opt_in bool not null default false`, `created_at`, `last_login_at`); extend `otp_code` with `audience text not null default 'user' check (audience in ('user','candidate'))` (inspect the existing otp migration first; unique partial index on `(email)` per audience if one exists).

**Step 2 — Module `services/api/src/modules/candidate-accounts/`**: repository, service, controller (`POST /cand/auth/otp/request|verify` mirroring the app auth shape, `GET /cand/me`, `PATCH /cand/me` for onboarding), DTOs with class-validator. OTP codes read from Mailpit exactly like `signup()` in test helpers.

**Step 3 — Wallet on signup (inside the signup transaction):** `ensureAccount('candidate', accountId)` + welcome grant (amount from a constant `CANDIDATE_WELCOME_GRANT_CREDITS = 50`, ledger reason `welcome_grant`, metadata `{product:'ascend'}`).

**Step 4 — Auth separation (D8):** candidate JWT carries `aud: 'candidate'` + `sub: accountId`; `CandidateAuthGuard` validates audience and loads the account (401 `INVALID_TOKEN` / 403 if an employer token is presented). Global guards must not apply to `/cand/*` (mirror how `/v1` sits outside the JWT stack).

**Step 5 — `apps/ascend-web` scaffolding (D12):** Vite + React + TS strict; `packages/ui` + `shared-types`; vitest with the `Request` wrapper (rule 8); pages: `LoginPage` (email → OTP), `OnboardingPage` (name, target role), placeholder shell with brand logo. PWA manifest + minimal service worker. Route guard holding a token in `sessionStorage`.

**Step 6 — Tests:** unit (service, guard audience matrix), integration `candidate-accounts.integration.spec.ts` (full OTP lifecycle via Mailpit, duplicate-email 409, onboarding PATCH, welcome grant ledger row, marketing_opt_in defaults false, employer token on `/cand/*` → 403); ascend-web unit tests for login/onboarding (mock API).

**Gate:** green + commit. Default amount 50 is **CONFIRM** with D11.

---

## Branch 2 — `phase-12/practice-engine` (4–5 days) — the reuse audit + practice core (D5, D6, D9)

**Step 0 — Reuse audit (pre-condition, written output in PR body):** for each engine (Interview, Question, Speech, Evaluation, Recording, Notification, Report, LLM gateway) state what Ascend reuses as-is / via port / needs refactoring. Concrete known outcomes: session state machine + turn loop **reused via a practice adapter**; evaluation **factored per D9**; reports rendered from `practice_report`.

**Step 1 — Migrations:** `practice_session` (`id uuid pk`, `account_id fk→candidate_account`, `mode text check (mode in ('text','voice'))`, `source text check (source in ('library','jd'))` — `resume_jd` arrives Branch 4, `title text`, `snapshot jsonb not null`, `status text` reusing the session state-machine enum, `consent_id uuid` nullable until consented, `account_id_for_credits` not needed — credits use the candidate's `credit_account` id column `credit_account_id uuid not null`, `recovery_token_hash text`, `started_at`, `completed_at`, `created_at`); `practice_consent` (`id uuid pk`, `session_id fk`, `account_id fk`, `recording_allowed bool not null`, `model_opt_in bool not null default false`, `text_version text not null`, `ip text`, `user_agent text`, `created_at`); `practice_transcript` (same shape as `session_transcript`, fk to `practice_session`); `practice_report` (same shape as `evaluation_report` + scores/evidence tables — mirror the live-mode schema so the report renderer and scorecard read paths work unchanged).

**Step 2 — Module `services/api/src/modules/practice/`**: repository, `practice.service.ts` (create → consent → preflight → turn loop → wrapup, mirroring `sessions.service.ts` but sourcing questions from `snapshot`), `practice-evaluation.service.ts` (D9: factor the judge/report pipeline from the evaluation module into a shared core both call), credits integration: on the live transition, in the same transaction — `ensureAccount('candidate', …)` → `assertCanStart` → `debit(..., 'practice_start', …)`; 402 maps to `INSUFFICIENT_CREDITS`; daily-cap check (D11) before create. Recovery via `x-recovery-token` exactly like interviews.

**Step 3 — Consent enforcement:** `POST /cand/practice/:id/consent` stores `practice_consent` (text version constant `PRACTICE_CONSENT_TEXT_V1` — write the v1 copy, plain English, recording + opt-in model-improvement clauses); preflight 409 `CONSENT_REQUIRED` without it. This is the X8 invariant — no exceptions.

**Step 4 — Data-wall tests (rule 3):** integration `practice-engine.integration.spec.ts` (UUID queue isolation): employer JWT → 403 on every `/cand/practice/*`; candidate A cannot read candidate B's session (404/403); full text-mode practice lifecycle with mocked LLM fixtures (question set comes from `snapshot` — seed it directly in test); debit exact price at live transition; 402 at zero balance with in-flight completion preserved; recovery-token flow; consent 409 without artifact; daily cap blocks the 4th create.

**Gate:** green. Tick phase-12-m2-outline pre-condition **"reuse audit"** with the PR-body link. Update `docs/STATE.md` (new E-row or extend E15: practice engine beta).

---

## Branch 3 — `phase-12/mock-player-report` (4–5 days) — Ascend UI: mock player + report + compose service

**Step 1 — Compose service:** `docker-compose.yml` `ascend-web` service (multi-stage build like sibling web Dockerfiles, nginx serving, host port **5175**), joins the compose network; CORS origin added to API (`CORS_ORIGIN` default includes `http://localhost:5175`).

**Step 2 — API additions:** practice session DTOs to shared-types (`PracticeSession`, `PracticeTurnResponse`, report read model reusing the scorecard shapes with `schema_version: 'v1'`); `GET /cand/practice/library` returning the built-in starter question sets (HR/behavioral/technical packs as seed JSON in the module — v1 content, 3 packs × 4 questions, rubric lines included; content review is an owner task later).

**Step 3 — Ascend pages:** `PracticeSetupPage` (pick pack or "paste a JD" placeholder until Branch 4, mode voice/text) → `PracticeConsentPage` (v1 consent text, checkbox for `model_opt_in`) → `PracticeInterviewPage` (text mode full implementation; voice mode = LiveKit room mirroring `VoiceInterviewPage`, with **audio-first low-bandwidth** defaults: no video track, degraded tile off — copy the candidate-web voice patterns) → `PracticeReportPage` (reuse the report renderer components from the evaluation read path; add coaching-tips section — LLM task `coaching-tips` v1.0.0, **evidence-linked**: each tip cites the metric/transcript span; mock fixture + contract test) → `PracticeReplayPanel` (jump-to-evidence moments). Wallet chip in shell (balance from `GET /cand/wallet` — new thin endpoint mapping the account).

**Step 4 — Tests:** ascend-web unit tests per page (mock API; include the Request-wrapper setup); API integration: report ready after wrapup (evaluation on practice transcript), tips cite evidence spans, wallet endpoint; extend `scripts/seed-ascend-sandbox.js` skeleton → full flow printout. E2E `apps/ascend-web/e2e/practice-text.spec.ts` (headless: OTP via Mailpit → onboard → text practice → report). **Rebuild the ascend-web image before e2e (rule 9).**

**Gate:** green + e2e green. Employer web untouched.

---

## Branch 4 — `phase-12/jd-resume-intelligence` (4–5 days) — JD-targeted mocks + resume (D10)

**Step 1 — LLM tasks (each: prompt JSON in `services/api/prompts/<task>/v1.0.0.json`, mock fixture in the fixture table — inspect `llm-gateway` module for the exact registration points — plus contract test + eval note in PR):**
- `practice-kit-from-jd` — JD (+ optional resume text) → question set with rubric lines (used to build `practice_session.snapshot`, source `'jd'`; for `source='library'` snapshots are seeded JSON, no LLM).
- `resume-parse` — raw text → structured profile jsonb.
- `ats-readiness-check` — parsed profile → issue list + fixes.
- `resume-jd-match` — profile + JD → coverage matrix, missing keywords, honest bullet-rewrite suggestions (guardrail in prompt: never invent metrics — output validated to contain only claims present in input; add a unit test asserting a fixture with a fabricated metric is rejected/flagged).

**Step 2 — Migrations:** `candidate_resume` (`id uuid pk`, `account_id fk`, `file_key text not null`, `parsed jsonb`, `ats_report jsonb`, `created_at`, unique(account_id) — one active resume per account, re-upload replaces).

**Step 3 — API:** `POST /cand/resume` (multipart or base64 JSON → MinIO `resumes/{accountId}/{uuid}` → parse task → row), `GET /cand/resume` (parsed + ats report), `POST /cand/practice/from-jd` (`{jd_text, mode}` → generation task → snapshot → session, source `'jd'`; resume included when present, `source` stays `'jd'`). Erasure: `DELETE /cand/resume` removes MinIO object + row.

**Step 4 — Ascend pages:** `ResumePage` (upload → parsing state → ATS-readiness card with fixes → match-against-target-role card), JD paste on PracticeSetup enabled (was placeholder), consent text v1 already covers processing.

**Step 5 — Tests:** unit (task prompts have fixtures; honesty guardrail test); integration (upload→parse via fixture, replace semantics, erasure removes object, from-jd creates session with snapshot, cross-account 404); ascend-web unit + one e2e extend (upload → ats card).

**Gate:** green.

---

## Branch 5 — `phase-12/coaching-readiness-beta` (3–4 days) — progress, readiness, wallet UI, beta close-out

**Step 1 — Readiness (deterministic, transparent):** `computeReadiness(accountId)` over the last N=5 completed practice sessions: weighted blend of evaluation scores + communication metrics (pace-in-range ratio, filler rate, structure score, STAR completeness — reuse Phase-14 measurement shapes). Formula as a documented pure function + `READINESS_FORMULA_V1` constant; response includes the formula version + component breakdown (transparency is a Blueprint requirement). No table — computed on read.

**Step 2 — API:** `GET /cand/progress` (session history, per-metric trend series, streaks from completed_at days), `GET /cand/readiness`, `GET /cand/wallet` (balance, threshold, ledger — reuse `listLedger`), low-balance email to the candidate via `CreditsAlertService` (holder type candidate — wired in Branch 0).

**Step 3 — Ascend pages:** `ProgressPage` (score history chart, skill radar, streaks), readiness card on home, `WalletPage` (balance, ledger table — copy the employer WalletPage visual language via `packages/ui`; "out of credits" state links to a static "credits are granted during the closed beta" notice + `mailto:` support address — no payments).

**Step 4 — Beta ops:** extend `scripts/grant-credits.js` to `--holder candidate --email <email> <amount> [reason]`; finalize `scripts/seed-ascend-sandbox.js` (account → grant → JD practice mock end-to-end over HTTP, printing curl steps like the integration sandbox); daily-cap constant review (D11); `docs/ascend-beta-runbook.md` (invite flow, grant flow, caps, erasure path, weekly COGS review checklist).

**Step 5 — Tests:** unit (readiness math against fixture sessions — deterministic cases incl. <5 sessions), integration (progress/readiness/wallet endpoints, alert email ≤1/24h), ascend-web unit; e2e extend (progress renders after a completed mock).

**Gate:** green.

---

## Final — `phase-12/beta-validation` (1–2 days)

1. Full matrix: API suite + ascend-web suite + both existing web suites + orchestrator suite, lint/typecheck everywhere, on a from-scratch compose build (`docker compose build ascend-web api && up -d`; no `down -v` needed — migrations already applied; run the full API suite once more against the rebuilt images).
2. Stand-in beta dress rehearsal over HTTP only: seed script → OTP login → onboarding → library mock → JD mock with resume → report with cited tips → progress/readiness → wallet + grant top-up → daily cap hit. Record transcript in the phase file Validation section (same standard as Phase 10).
3. Docs: `docs/STATE.md` (Ascend beta row: what exists, caps, deviations D-log), `CONTEXT.md` (new app, port 5175, holder-type wallets, new gotchas), tick phase-12-m2-outline checkboxes with evidence; note remaining pre-conditions still open (pilot gate — Phase 11).
4. **Tag `phase-12-complete`. Do NOT tag `v0.2.0-pilot`** — that waits for Phase 11's pilot gate.
5. Owner confirmations collected during execution (D4, D11, grant amount, consent text v1, library pack content) — list them in the final PR for sign-off.

## Validation (2026-09-23)

**Full matrix (all green):** API 358 passed / 2 skipped (65 files) · ascend-web 29 unit + 2/2 E2E · employer-web 102 unit + 12/12 E2E · candidate-web 13 unit + 5/5 E2E · orchestrator 104 passed / 2 skipped, ruff + mypy strict clean · lint + typecheck clean on api, ascend-web (employer/candidate suites re-run on the rebuilt images; counts unchanged from the Phase-10 snapshot).

**Dress rehearsal** — `node scripts/seed-ascend-sandbox.js` against the compose stack, HTTP only, mock LLM. Transcript (condensed; full output reproducible by re-running the script):

1. `POST /cand/auth/otp/request` → 200; OTP read from Mailpit.
2. `POST /cand/auth/otp/verify` → 200, account created; wallet shows balance **50** (`welcome_grant +50`).
3. `PATCH /cand/me` → onboarding saved.
4. `GET /cand/practice/library` → 3 packs × 4 questions, `PRACTICE_CONSENT_TEXT_V1`.
5. `POST /cand/practice` (hr-screening, text) → 201; consent → 201 (X8 artifact stored); preflight → 200 live, **exact −1 debit** (`practice_start`), balance 49.
6. Turn loop → wrapup after 4 answers; `GET .../report` → status completed, recommendation 4, 8 scores all with evidence spans, 8 spans, coaching tips each quoting a verbatim transcript span.
7. `POST /cand/resume` (pasted text) → 201, parsed skills + ATS score 95.
8. `POST /cand/practice/from-jd` → 201, `source: 'jd'`, resume-informed snapshot; full lifecycle → wrapup (2nd completion).
9. Third library mock → wrapup (3 completions = daily cap).
10. `GET /cand/practice/progress` → 3 sessions, 3-entry trend series (pace 25 wpm, 0 fillers each), streak 1, dailyCap 3. `GET /cand/practice/readiness` → **70** (`READINESS_FORMULA_V1`: scoreBlend 80, pace 0, fillers 100, structure 100; sessionsUsed 3 — pace 0 is correct: 25 wpm is below the 100–180 confident range).
11. `grant-credits.js --holder candidate --email <user> 25` → balance 72; wallet ledger reads `admin_grant +25, practice_start −1 ×3, welcome_grant +50`.
12. 4th `POST /cand/practice` → **429 `DAILY_CAP_REACHED`** ("the beta allows 3 completed mocks per day").

**Owner confirmations (for sign-off in the final PR):** D4 pricing reuse (text 1 / voice 2) — CONFIRM; D11 cap 3/day + weekly manual ledger review — CONFIRM; welcome grant 50 — CONFIRM; consent text v1 copy — shipped as `PRACTICE_CONSENT_TEXT_V1` (review pending); library pack v1 content (3 packs × 4 questions) — shipped (content review is an owner task); monetization deviation (grants instead of freemium) — approved in writing pre-Phase-12.

**Execution deviations from this plan's letter (all recorded):**
- Progress/readiness endpoints live at `/cand/practice/progress` and `/cand/practice/readiness` (under the practice controller), not `/cand/progress` / `/cand/readiness` — same contract shapes, one route namespace.
- Progress page ships an inline-SVG trend chart, not a skill radar (radar needs ≥3 independent axes of real data we don't credibly have yet).
- Voice-mode practice UI deferred (text-only turn API this drop; already logged in the Branch 3 merge).
- Resume v1 parsing is paste-text (binary/PDF parsing deferred; already logged in the Branch 4 merge).
- One direct-to-main chore commit (`c23fb9e`, seed-script rehearsal extension) — recorded in `docs/STATE.md` §7; not repeated.


## Estimated totals

| Branch | Days | Main risk |
| --- | --- | --- |
| 0 wallet-accounts | 2–3 | touching proven ledger code (mitigated: behavior-identical gate) |
| 1 candidate-accounts | 3–4 | OTP audience migration on a live table |
| 2 practice-engine | 4–5 | evaluation factoring (D9) — keep the read model shared, tables separate |
| 3 mock-player-report | 4–5 | voice room parity + low-bandwidth defaults |
| 4 jd-resume-intelligence | 4–5 | honesty guardrail on resume-JD match |
| 5 coaching-readiness-beta | 3–4 | readiness formula credibility — keep it simple and documented |
| final | 1–2 | dress rehearsal discipline |

**~21–27 working days** sequential. Branches 3 and 4 can overlap only if two people work; keep sequential for CI calm (same rule as Phase 10).
