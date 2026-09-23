# Ascend (M2) Closed-Beta Runbook

How to run the Ascend candidate practice beta on the compose stack: onboarding,
credit grants, guardrails, support flows, and data erasure. Target reader: the
team member operating the beta.

Related docs: [STATE](./STATE.md) for build-state tracking, the
[Phase 12 implementation plan](../phases/phase-12-implementation-plan.md) for
what was built and why.

## 1. What the beta user gets

- **Ascend web app** at `http://localhost:5175` (compose service `ascend-web`,
  API at `http://localhost:3000`).
- **OTP sign-in** — no password. The 6-digit code lands in the dev mailbox
  (Mailpit at `http://localhost:8025`) in this environment; in a hosted beta it
  goes through the configured email provider.
- **Welcome grant**: 50 practice credits on first sign-in (ledger reason
  `welcome_grant`, metadata `product: ascend`).
- **Practice mocks**: library packs or JD-targeted sets; text mode in this drop.
  A mock costs exactly 1 credit, debited at the live transition
  (reason `practice_start`) — never at create, so abandoned sessions are free.
- **Guardrails**: max 3 completed mocks per account per day (429
  `DAILY_CAP_REACHED`), low-balance alert email at most once per 24 h.
- **Outputs**: evidence-linked coaching report per mock, readiness score
  (`READINESS_FORMULA_V1`) over the last 5 judged mocks, pace/filler trend
  series, streak, wallet ledger.

## 2. Onboarding a beta user

1. Send the user the Ascend URL. There is no invite flow in this drop — the
   closed beta is URL + operator awareness.
2. The user signs in with their email and the OTP from their inbox.
3. First sign-in creates the account and grants 50 credits automatically.
4. For a seeded demo account instead, use
   `node scripts/seed-ascend-sandbox.js` and read the credentials it prints.

Verify an account exists (operator):

```sql
SELECT id, email, name, created_at FROM candidate_account WHERE email = 'user@example.com';
```

## 3. Granting credits (admin-configurable until Razorpay)

Payments are intentionally deferred (decision B in the Phase 12 plan): the
operator adjusts balances manually. Balance + ledger row update in one
transaction; the ledger stays the source of truth.

```bash
# Candidate top-up (Ascend beta):
DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos \
  node scripts/grant-credits.js --holder candidate --email user@example.com 50 "beta top-up"

# Org top-up (Meridian side, unchanged):
node scripts/grant-credits.js Acme 500 "pilot top-up"
```

The user sees the grant in **Wallet** as a `Beta top-up` ledger line
immediately (WalletChip refetches on navigation).

## 4. Support flows

### Out of credits

The wallet page shows a closed-beta notice with a `mailto:` top-up request.
Operator action: grant per §3.

### Daily cap hit

The API returns 429 `DAILY_CAP_REACHED`. This is working as designed (COGS
guardrail) — tell the user it resets the next day. Do not grant extra credits
to bypass the cap; the cap counts *completed* mocks, not credits.

### Low-balance alert

When a practice debit drops the balance below the account's alert threshold,
the candidate gets `Ascend: your practice credits are running low` — at most
once per 24 h (Redis watermark `lowbal:<accountId>`). No operator action
unless the user replies; then grant per §3.

## 5. Weekly COGS review checklist

- [ ] Count completed practice mocks this week:
      `SELECT count(*) FROM practice_session WHERE status = 'completed' AND completed_at > now() - interval '7 days';`
- [ ] Active beta accounts:
      `SELECT count(*) FROM candidate_account WHERE created_at > now() - interval '7 days';`
- [ ] Mock LLM task costs per report (sanity vs. budget):
      `SELECT avg(cost) FROM practice_report WHERE status = 'completed';`
- [ ] Alert watermarks expiring naturally (24 h TTL) — no cleanup needed.
- [ ] Any balance corrections done via `grant-credits.js` have a ledger row
      with a human-readable `note`.

## 6. Data erasure (right to deletion)

M2 keeps all candidate data in its own tables; nothing touches employer
(Meridian) tables. V1 erasure is a manual, scripted procedure per email —
there is no self-serve delete in this drop. Run inside a transaction and
verify row counts before COMMIT:

```sql
-- 1. Resolve the account
CREATE TEMP TABLE erasure_target AS
SELECT id AS account_id, email FROM candidate_account WHERE email = 'user@example.com';

-- 2. Reports (scores + evidence spans first: they reference the report)
DELETE FROM practice_report_score WHERE report_id IN (
  SELECT id FROM practice_report WHERE account_id IN (SELECT account_id FROM erasure_target));
DELETE FROM practice_report_evidence_span WHERE report_id IN (
  SELECT id FROM practice_report WHERE account_id IN (SELECT account_id FROM erasure_target));
DELETE FROM practice_report WHERE account_id IN (SELECT account_id FROM erasure_target);

-- 3. Practice sessions and everything they hold
DELETE FROM practice_transcript WHERE session_id IN (
  SELECT id FROM practice_session WHERE account_id IN (SELECT account_id FROM erasure_target));
DELETE FROM practice_consent WHERE account_id IN (SELECT account_id FROM erasure_target);
DELETE FROM practice_session  WHERE account_id IN (SELECT account_id FROM erasure_target);

-- 4. Resume (also delete the MinIO object under resumes/<accountId>/)
DELETE FROM candidate_resume WHERE account_id IN (SELECT account_id FROM erasure_target);

-- 5. Wallet (account + ledger rows)
DELETE FROM credit_ledger  WHERE account_id IN (
  SELECT ca.id FROM credit_account ca
  WHERE ca.holder_type = 'candidate' AND ca.holder_id IN (SELECT account_id FROM erasure_target));
DELETE FROM credit_account WHERE holder_type = 'candidate'
  AND holder_id IN (SELECT account_id FROM erasure_target);

-- 6. Auth state + the account itself
DELETE FROM candidate_session WHERE account_id IN (SELECT account_id FROM erasure_target);
DELETE FROM candidate_otp WHERE invite_id IN (
  SELECT id FROM org_invite WHERE email IN (SELECT email FROM erasure_target));
DELETE FROM candidate_account WHERE id IN (SELECT account_id FROM erasure_target);
```

Consent artifacts (`practice_consent`) are deleted with the session by design
in the beta: erasure means erasure. If a jurisdiction requires retained
consent proof, export before step 2.
