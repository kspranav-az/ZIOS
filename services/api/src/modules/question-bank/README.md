# question-bank module — seeded internal question bank (PRD E4)

Owns the `question_bank_item` schema and `GET /bank/questions` (FR-E4-1).
The bank is **global seeded reference data** (no `org_id`) shared by all
orgs, so repository reads deliberately use plain pool queries — the
fail-closed tenant helper applies to tenant data, and there is no tenant
column here.

## Endpoints

| Route                                                                         | Notes                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /bank/questions?query=&role_family=&topic=&type=&difficulty=&tag=&page=` | Any authenticated role. ILIKE search on prompt+topic, exact filters, deterministic order (family, topic, id), **50 items/page**, `{items, page, pageSize, total, totalPages}`. Bad enum/page values → `400 VALIDATION_ERROR`. |

Cloning into a kit lives in the kits module:
`POST /kits/:id/questions/from-bank {bankItemId, topic?}` → the new question
carries `source: 'bank'` and `sourceRef: <bank item id>` (FR-E4-3).

## Seeding (FR-E4-1)

`pnpm seed` (or `pnpm --filter @zios/migrations seed`) runs
`infra/migrations/seed.js` after migrations have been applied:

- **533 items across 13 role families** (6 engineering families + sales,
  customer-support, hr-ops, finance, marketing, product-management,
  campus-fresher-general); every family covers all four §6.2 types.
- Every item has 2–4 rubric lines with weights summing to 1 (the generator
  validates all schema invariants before inserting).
- **Idempotent**: ids are deterministic (sha256 over family|type|prompt) and
  inserts use `ON CONFLICT (id) DO NOTHING`, so re-runs insert 0 rows.
- Content is hand-curated per family plus shared behavioral / situational /
  screening pools and skill-parameterized frames — real Indian-hiring
  questions, no filler.
