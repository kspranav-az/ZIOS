# ZIOS — AI Interview Ecosystem (`InterviewOS` / `Meridian`)

Two products on one shared AI interview platform, built India-first:

- **`Meridian`** — employer interview platform. **This is Milestone 1 (MVP) and the current build target.**
- **`Ascend`** — candidate practice app (M2). Reuses every engine built for M1.
- **`InterviewOS`** — the shared platform spine (Interview Engine, Question Engine, Speech Pipeline, Evaluation Engine, consent/identity, notifications, report rendering).

## Read these first

| Document | Role |
|---|---|
| [`docs/AI Interview Ecosystem PRD - MVP Employer Platform.md`](docs/AI%20Interview%20Ecosystem%20PRD%20-%20MVP%20Employer%20Platform.md) | **Governs scope.** The M1 contract: epics E1–E14, FR IDs, X1–X10 exit criteria, in/out scope. |
| [`docs/AI Interview Ecosystem Blueprint.md`](docs/AI%20Interview%20Ecosystem%20Blueprint.md) | **Governs architecture depth** where the PRD is silent (AI architecture, cost model, compliance, long-term vision). |
| [`phases/README.md`](phases/README.md) | Phase-wise implementation plan with verification/validation checklists and the git workflow between phases. |
| [`AGENTS.md`](AGENTS.md) | Engineering conventions every contributor (human or agent) must follow. |

Where the two docs conflict on sequencing, **the PRD wins** (Meridian ships first; Ascend in M2).

## Design source of truth

`AI-Interview-Platform/` is a **local, git-ignored design reference clone** (React 19 + Vite + Tailwind 4, ZeTheta theme, `BrandLogo`/zetheta-logo, recruiter & candidate layout shells). All UI we build must match its theme, logo, and screen flows exactly. It is never committed, never deployed, and never treated as production code.

## Local infrastructure (Docker)

All dev/test infrastructure is containerised — no locally installed services required:

```bash
cp .env.example .env
docker compose up -d        # postgres · redis · minio(S3) · mailpit(SMTP) · livekit
docker compose ps           # wait until all services are healthy
```

Real third-party providers (LLM, STT/TTS, WhatsApp, Razorpay, Google OAuth) are **deliberately deferred to their scheduled phases** — early phases build against provider-agnostic interfaces with local stubs. See `phases/README.md`.

## Status

Pre-implementation. Phase 00 (engineering foundation) is the entry point: [`phases/phase-00-foundation.md`](phases/phase-00-foundation.md).
