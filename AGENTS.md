# AGENTS.md — Engineering Conventions

Binding rules for every contributor (human or AI agent) working in this repository. The product contract lives in `docs/`; the build sequence lives in `phases/`; this file governs *how* we work.

## 1. Source-of-truth hierarchy

1. **Scope:** `docs/AI Interview Ecosystem PRD - MVP Employer Platform.md` — the in/out table (§3.4) is frozen. Adding scope to M1 requires trading something of equal size out, in writing, in the PRD.
2. **Architecture depth:** `docs/AI Interview Ecosystem Blueprint.md` — governs where the PRD is silent.
3. **Sequencing:** `phases/` — the phase files are the executable plan. Work happens in phase order; a phase is not "done" until every verification *and* validation checkbox in its file is checked.
4. **Design:** `AI-Interview-Platform/` (git-ignored local clone) — theme, logo, and screen flows are copied from it exactly. Never invent a divergent design language.

## 2. Non-negotiable product invariants (never trade these away)

- **Consent before capture:** no media is ever captured before a stored consent artifact (PRD X8 — 100% of sessions).
- **Evidence-linked scoring:** every score cites ≥ 1 transcript span; ungrounded scores are rejected at the schema layer.
- **AI never auto-rejects:** integrity output is flags + evidence; a named human dispositions everything. Zero auto-reject code paths.
- **No emotion/personality/face inference** — observable delivery behavior only (pace, fillers, structure).
- **Provider independence:** no feature code names a vendor model/provider. Everything external sits behind a port (interface) in the relevant module.

## 3. Third-party integration discipline

Real third-party integrations are **scheduled, not incidental**. Each phase file lists the integrations allowed in that phase. Until a provider's phase arrives, build against its local stub (Mailpit for email, MinIO for S3, LiveKit dev server for media, stub adapters for LLM/STT/TTS/payments). If a task seems to require a provider early, stop and re-plan — don't wire it ad hoc.

## 4. Git workflow (applies intra- and inter-phase)

- **Trunk-based:** `main` is always green and releasable. No direct commits to `main`.
- **Branches:** `phase-NN/<short-slug>` for phase work, e.g. `phase-02/kit-versioning`. Short-lived; one concern per branch.
- **Commits — Conventional Commits, imperative, with body:**
  ```
  feat(kit-builder): add immutable kit versions on publish

  Publishing freezes the kit snapshot and binds invites to kit_version_id
  so reports always reference the exact definition used (FR-E2-5).
  ```
  Types: `feat` `fix` `chore` `docs` `test` `refactor` `perf` `ci` `build`. Scope = module/epic. Reference the FR ID in the body when applicable. Small, coherent commits — a reviewer should understand each one independently.
- **Merge:** squash-merge via PR after CI is green and the phase checklist items it covers are ticked in the same PR.
- **Phase gates:** when a phase's exit gate passes, tag it: `git tag -a phase-NN-complete -m "..."`. Milestone tags: `v0.1.0-mvp0` (Phase 06), `v0.2.0-pilot` (Phase 11).
- **Never** rewrite published history, never commit secrets, never commit `AI-Interview-Platform/`.

## 5. Docker-first development & testing

- No locally installed databases/services. `docker compose up -d` is the only setup step for infrastructure.
- Every app service ships a multi-stage `Dockerfile` (added in Phase 00/its first phase) and joins `docker-compose.yml`; CI builds the images and runs integration tests against compose services.
- Tests must be hermetic: they run against the compose stack (or testcontainers) with no real third-party credentials.

## 6. Testing & quality gates (CI enforces all)

- **Unit tests** for domain logic; **integration tests** for DB/queue/storage adapters; **contract tests** for every provider port (stub and real adapter must pass the same suite); **E2E (Playwright)** for the golden journeys defined in each phase file.
- Lint + format + typecheck on every PR. Migrations follow expand-migrate-contract; never destructive in one release.
- AI changes (prompts, model routes, judges) are versioned artifacts and ship only with an eval note in the PR (offline golden-set result), even while the harness is stubbed.

## 7. Architecture guardrails (from the Blueprint)

- Modular monolith core (NestJS) + separate AI orchestration workers (Python); hot planes (media/speech/eval) scale independently.
- Bounded contexts own their schemas; no shared tables across contexts; cross-context communication via contracts/events (outbox pattern).
- The interview session is a state machine and a saga, not request-response. Every state transition emits an event.
- Keep it boring: Postgres, Redis, S3-compatible storage, queue. Complexity budget goes to trust, integrity, and unit economics only.

## 8. Definition of done (any task)

Code + tests + docs updated (including `phases/` checkboxes) + CI green + conventions in this file upheld. When in doubt, prefer the smallest change that satisfies the FR and matches existing patterns.
