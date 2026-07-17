# kits module — interview kit builder, versioning, preview (PRD E2)

Owns the `kit` / `kit_version` / `question` schemas and everything under
`/kits` and `/preview`. The **kit row is the mutable draft head**; publishing
freezes an immutable `kit_version` snapshot (FR-E2-5) that invites and reports
will reference forever. All data is org-scoped through the session tenant
context; both roles (`admin`, `interviewer`) may author, publish, and archive.

## Endpoints

| Route                                                  | Notes                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `POST /kits`                                           | Create with optional partial `settings` → `201 {kit}`                                                        |
| `GET /kits?status=`                                    | List org kits (`draft\|published\|archived`), newest first                                                   |
| `GET /kits/:id`                                        | `{kit, questions, topics}` — the builder's working document                                                  |
| `PATCH /kits/:id`                                      | Title/role/level; guarded write (see below)                                                                  |
| `PATCH /kits/:id/settings`                             | Partial settings merge; guarded write                                                                        |
| `POST /kits/:id/archive` · `POST /kits/:id/unarchive`  | Idempotent; unarchive restores `published` if versions exist, else `draft`                                   |
| `POST /kits/:id/publish`                               | Validates → freezes version `max+1` → `201 {version}`; `422 PUBLISH_VALIDATION_FAILED {details[]}` otherwise |
| `GET /kits/:id/versions` · `GET /kits/:id/versions/:v` | Version metadata, then the exact frozen snapshot                                                             |
| `PATCH/PUT/DELETE /kits/:id/versions/:v`               | Always `409 VERSION_IMMUTABLE` (explicit rejection routes)                                                   |
| `GET /kits/:id/duration-estimate`                      | `{baseSeconds, estimatedSeconds, capSeconds, withinCap, perQuestion[]}`                                      |
| `POST /kits/:id/preview-token`                         | `{token, expiresAt, expiresInSeconds: 1800}`                                                                 |
| `GET /preview/:token`                                  | Authenticated + org-bound; read-only draft projection with `preview: true`                                   |
| `POST /kits/:id/questions`                             | Append by default; `beforeQuestionId` inserts in place                                                       |
| `GET /kits/:id/questions`                              | Ordered by fractional `position`                                                                             |
| `PATCH /kits/:id/questions/:qid`                       | Guarded write                                                                                                |
| `DELETE /kits/:id/questions/:qid`                      | `204`                                                                                                        |
| `POST /kits/:id/questions/reorder`                     | `{questionIds}` = the full new order (every id exactly once)                                                 |
| `POST /kits/:id/questions/from-bank`                   | `{bankItemId, topic?}` clones with `source:'bank'`, `sourceRef`                                              |
| `PATCH /kits/:id/topics`                               | `{from, to}` renames a topic across questions                                                                |

## Autosave & concurrency contract (FR-E2-1)

- Every entity response carries `updatedAt`. Send it back as
  `expectedUpdatedAt` in the PATCH body; if the stored value has moved, the
  write is refused with `409 STALE_WRITE` (+`currentUpdatedAt` so the client
  can rebase). Omitting `expectedUpdatedAt` = last-writer-wins.
- `updatedAt` is millisecond-truncated at write time so the ISO round-trip
  compares equal — clients can use the raw response string verbatim.
- Question create/delete/reorder/from-bank/topic-rename also bump the kit's
  `updatedAt` (the set changed); single-question PATCHes bump only the
  question's own `updatedAt`.
- Reorder is set-based and idempotent: send the complete ordered id list
  (server rebases fractional positions in one transaction; `400` if the id
  set doesn't match the kit exactly). Two concurrent reorders both succeed —
  last write wins, and both results are valid orders.
- `position` values are opaque fractional-index keys. Read them, never parse
  or edit them.

## Publish validation (422 details)

Title/role/level required; ≥ 1 question; every question passes the draft
shape rules and has ≥ 1 rubric line whose weights sum to 1 (±0.01); the
duration estimate (per-question limits, default 120s, +20% overhead) must fit
`settings.totalTimeCapSec`.

## Preview (FR-E2-6)

`POST /kits/:id/preview-token` mints a 30-minute HMAC-signed token
(`PREVIEW_TOKEN_SECRET`; a documented dev default exists for local/CI).
`GET /preview/:token` requires a session **of the same org** — preview is
employer-internal, so rubric lines are included. It is a pure read
projection: no session rows, no persistence writes of any kind.

## Errors

`KIT_NOT_FOUND` (404, also for cross-org ids), `QUESTION_NOT_FOUND`,
`VERSION_NOT_FOUND`, `BANK_ITEM_NOT_FOUND`, `VERSION_IMMUTABLE` (409),
`STALE_WRITE` (409), `KIT_ARCHIVED` (409), `PUBLISH_VALIDATION_FAILED` (422
with `details[]`), `PREVIEW_TOKEN_INVALID` (404), `PREVIEW_TOKEN_EXPIRED`
(410), `VALIDATION_ERROR` (400 with `details[]` for question-shape errors).

## Immutability belt-and-braces

The service exposes no update/delete path for `kit_version`, explicit routes
reject mutations with 409, and a DB trigger
(`reject_kit_version_mutation`) raises on direct UPDATE/DELETE while still
allowing cascade deletes from org/kit teardown (`pg_trigger_depth() < 2`).
