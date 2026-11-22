# Execution Roadmap — Demo-Bug Fixes First, Auth Plans on Hold

**Status as of 2026-11-22:** snapshot tag `demo-snapshot-2026-11-22` created at
`0334e57` (pushed). If a demo lands mid-execution, rollback is:

```
git checkout demo-snapshot-2026-11-22   # read-only inspection
# or a hotfix branch off it:
git checkout -b hotfix/demo demo-snapshot-2026-11-22
```

Docker images at that commit are whatever is currently running (all services
rebuilt as of 2026-11-22; `verify-live-e2e.js` green). Code rollback does not
roll back the DB — migrations added by executed plans make a true DB rollback
impractical; prefer forward-fixing on a hotfix branch.

## Execution order (each plan runs as its own goal, in this sequence)

### Phase A — `plans/employer-report-and-dashboard-fixes.md` *(branch `fix/employer-report-dashboard`)*
**Why first:** fixes the exact screens shown in a demo tonight (timeline
all-"Pending", wrong Started/Completed, free-text reason code, dead dashboard).
Pure employer-web + small API additions; lowest risk, highest demo visibility.
No infra (orchestrator) rebuild needed.

### Phase B — `plans/admin-credit-topup.md` *(branch `feat/admin-credit-topup`)*
**Why second:** tiny (3 commits), makes seed/demo data auditable — the wallet
ledger stops showing unexplained jumps. Quick win before the bigger practice
work. Requires `api` image rebuild before scripts use the endpoint.

### Phase C — `plans/practice-interview-ux-and-live-wiring.md` *(branch `fix/practice-interview-ux-live-wiring`)*
**Why third:** the biggest one (7 commits, two services + two web apps).
Orchestrator rebuild is slow (~3 min amd64) and Step 1/1b change live AI
behavior (real STT, real media analysis). Do it once A and B are already
proving stable. Includes the `CORRUPT_MEDIA` probe fix + DLQ redrive backfill —
after this, browser-recorded async-video answers show real measurements.

### Phase D — `plans/employer-invite-ui-and-email.md` *(branch `feat/employer-invite-ui`)*
**Why last of the four:** largest UI surface (new dialog, roster rewrite,
email). Independent of A–C; lands when the demo-critical fixes are done.
Optionally defer if a demo is near — it adds rather than fixes.

### On hold (do not start)
- `plans/password-auth-and-team-management.md`
- `plans/external-sso-and-oauth.md`

Both touch `auth.controller.ts`; starting them mid-sequence would collide with
demo prep. Revisit after Phase D (or after the demo happens).

## Between phases (every time)
1. Full gates from the plan file (tests, lint, typecheck, image rebuilds, `verify-live-e2e.js`).
2. `--no-ff` merge with conventional-prefixed message, push SSH remote.
3. Tag lightweight checkpoint: `git tag checkpoint-<phase>-<date>` after each green merge — finer rollback points than the snapshot.

## Rollback ladder (demo-day options)
1. **Code-only:** `git checkout demo-snapshot-2026-11-22` (or latest checkpoint tag).
2. **Images too:** after checkout, `docker compose up -d --build` the affected services.
3. **DB caveat:** data written by newer code stays; all Phase A–D migrations are additive (new columns/endpoints), so older code still runs against the newer schema.
