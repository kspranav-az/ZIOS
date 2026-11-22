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

### Phase B — `plans/employer-invite-ui-and-email.md` *(branch `feat/employer-invite-ui`)*
**Why second:** the dashboard fix (Phase A) makes the employer shell feel alive;
this completes the employer story while that context is hot — the Candidates
page becomes the invite hub (single + bulk CSV, kit/version pickers,
copy-link-once) with a real invite email, and the roster shows real statuses.
Pure API + employer-web; no orchestrator, no AI behavior changes.

### Phase C — `plans/admin-credit-topup.md` *(branch `feat/admin-credit-topup`)*
**Why third:** tiny (3 commits) but requires an `api` image rebuild and re-runs
of the seed scripts — better done after the employer-visible work is merged and
stable. Makes seed/demo wallet data auditable (no more unexplained balance
jumps in the ledger).

### Phase D — `plans/practice-interview-ux-and-live-wiring.md` *(branch `fix/practice-interview-ux-live-wiring`)*
**Why last:** the biggest one (7 commits, two services + two web apps).
Orchestrator rebuild is slow (~3 min amd64) and Step 1/1b change live AI
behavior (real STT, real media analysis) — do it when nothing demo-critical is
in flight and there's time to smoke the full voice/video practice flows.
Includes the `CORRUPT_MEDIA` probe fix + DLQ redrive backfill — after this,
browser-recorded async-video answers show real measurements.

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
