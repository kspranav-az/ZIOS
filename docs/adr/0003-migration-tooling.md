# ADR-0003: Migration tooling — node-pg-migrate in infra/migrations

**Status:** Accepted · **Date:** 2026-07-16 (Phase 00)

## Context

AGENTS.md §6 requires expand-migrate-contract migrations, hermetic against
the compose Postgres. The schema serves both the NestJS api and the Python
ai-orchestrator (bounded contexts own their schemas; no shared tables across
contexts), so coupling migrations to any one service's ORM would be wrong.

## Decision

- **Tool:** `node-pg-migrate` — plain-SQL semantics with up/down JS
  migrations, no ORM, no model sync, explicit and boring (matches "keep it
  boring", AGENTS.md §7).
- **Placement:** `infra/migrations/` as its own workspace package
  (`@zios/migrations`), not inside `services/api`:
  - schema is shared infrastructure; the Python service must be able to
    migrate without depending on the api runtime or its ORM-of-the-day;
  - deployment concern separation: the migrate step runs standalone (dev
    script now, CI/deploy job later) independent of app startup;
  - per-context migration directories can later live side by side
    (`migrations/identity/`, `migrations/kit/`, …) as bounded contexts land,
    keeping schema ownership visible.
- **Runner:** `pnpm migrate [up|down] [n]` from the repo root. It loads
  repo-root `.env` when present (real env vars win) and targets
  `DATABASE_URL`; `down` defaults to rolling back one migration.
- **Discipline:** migrations are additive-only within a release
  (expand → migrate → contract across releases); published migration files
  are immutable.

Alternatives considered: TypeORM/Prisma migrations (couple schema to the api
ORM — rejected), Drizzle kit (nice, but another ORM-adjacent dependency for
zero feature need this early), raw `psql` scripts (no tracking table,
no down migrations — rejected).

## Consequences

- First migration creates `org` and `app_user` (+ `citext`), matching the
  Phase 00 checklist and Phase 01's identity needs; `pnpm migrate down`
  reverts it cleanly.
- Migration files are CommonJS `.js` (node-pg-migrate's zero-risk path);
  everything else in the repo is TS/ESM — acceptable local inconsistency,
  documented here.
- CI compose-smoke does not yet run migrations (no service consumes the
  schema in Phase 00); a migrate-and-verify CI step arrives with the first
  schema-consuming feature in Phase 01.
