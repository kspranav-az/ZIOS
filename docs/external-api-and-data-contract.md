# ZIOS — External API & Data Contract

**Audience:** external applications and dashboards integrating with the ZIOS platform (data pull, partner API, reporting).

**Snapshot:** 2026-10-07 · HEAD `main` @ `0d24ca8` · Schema extracted from the live database (`information_schema` + `pg_constraint`), not from ORM models — this is the deployed truth, including every `CHECK` constraint (which is where the status vocabularies live; the platform uses text columns, not PG enums).

---

## 1. System topology

| Service | Tech | Port | Role |
|---|---|---|---|
| `api` | NestJS (TypeScript strict) | 3000 | The monolith. All REST below except §7. Owns the Postgres schema. |
| `ai-orchestrator` | FastAPI (Python, ruff+mypy strict) | 8000 | AI workers: voice-room WebSocket, STT/TTS/LLM adapters, multimodal analysis. Internal (§7). |
| `livekit` | LiveKit SFU | 7880 (dev) / Cloud in prod | Real-time media plane for voice/video/human-live rooms. |
| Postgres | 15+ | 5432 (55432 dev) | Single source of truth — full schema in §8. |
| Redis | — | 6379 | Queues (BullMQ), rate limiting, OTP throttling. Not a data store. |
| MinIO (S3-compatible) | — | 9000 | **All media**: recordings (WAV/WebM), ID uploads, resume PDFs. Only *references* live in Postgres. |

Two products share this one schema:

- **Meridian** (employer platform): kits → invites → interviews → transcripts → evaluation reports.
- **Ascend** (candidate practice): practice sessions/transcripts/reports, credits wallet, resume parsing.

**Naming conventions:** DB is `snake_case`, API JSON is `camelCase`. All timestamps are `timestamptz` (UTC). All ids are `uuid` (`gen_random_uuid()`). Emails are `citext` (case-insensitive). Money is **credits**: integer units, never floats. Every token in the DB is a **hash** — raw tokens exist only in transit.

---

## 2. Credential & access model (read this first)

Seven credential types. Each route below declares which one(s) it accepts.

| # | Credential | Transport | What it proves | Backed by |
|---|---|---|---|---|
| 1 | Employer session | `zios_session` httpOnly cookie (first) or `Authorization: Bearer <sessionToken>` | `app_user` in an `org` (role `admin` or `interviewer`) | `session` table (sha256 of token) |
| 2 | Candidate session | `Authorization: Bearer <candidateSessionToken>` (no cookie — Ascend stores it client-side) | `candidate_account` (Ascend login) | `candidate_session` table |
| 3 | Invite token | URL path `/invites/by-token/:token` or candidate-web link | Possession of the interview link | `invite.token_hash` |
| 4 | Recovery token | `x-recovery-token: <token>` header | Right to drive a live session's turns | `interview_session.recovery_token_hash` / `practice_session.recovery_token_hash` |
| 5 | Partner API key | `Authorization: Bearer zios_test_…` / `zios_live_…` | Org-level machine access (scoped) | `api_key.key_hash` (sha256) |
| 6 | Share link | `/reports/share/:token` | Read access to one evaluation report | `report_share_link.token_hash` |
| 7 | Webhook secret | HMAC in `x-zios-signature` header | Verifies webhook deliveries to you | `webhook_endpoint.secret` |

Error envelope for every API error (consistent):

```json
{ "statusCode": 409, "code": "SESSION_STATE_INVALID", "message": "session is consented" }
```

Common codes: `401 UNAUTHORIZED` / `INVALID_API_KEY`, `403 FORBIDDEN_SCOPE`, `404 NOT_FOUND` (no existence leaks — wrong owner and missing id both 404), `409 SESSION_STATE_INVALID` / `TIME_LIMIT_EXCEEDED` / `SESSION_MODE_INVALID`, `429 RATE_LIMITED` (with `Retry-After`), `502 ORCHESTRATOR_ERROR` / `TRANSCRIPTION_FAILED`, `400 VALIDATION_ERROR`.

---

## 3. Partner Integration API v1 (`/v1/interviews`) — the primary external contract

Machine-to-machine. No sessions; org identity comes from the API key. Keys are managed under `/integration-api/keys` (employer session auth): `POST` (create → returns the raw key once), `GET` (list), `POST :id/rotate`, `POST :id/revoke`. Keys carry `scopes[]` (default `['interviews:read','interviews:write']`), `kind: 'test'|'live'`, `rate_limit_per_min` (default 120, Redis fixed-window → 429).

### `POST /v1/interviews` — create an interview (`interviews:write`)

```json
{
  "kit_id": "uuid (optional — bind an existing published kit)",
  "jd_text": "string (optional — a kit is generated from this JD instead)",
  "candidate": { "name": "…", "email": "…", "phone": "…", "external_ref": "your-id" },
  "mode": "text | voice | video | human",
  "proctoring_level": "none | standard | strict",
  "send_invite": false
}
```

- Either `kit_id` (existing kit) or `jd_text` (on-the-fly kit generation) is required.
- `mode: "human"` = human-conductor interview, backed by a video-mode kit (LiveKit room).
- `candidate.email` is optional; `external_ref` is your system's id and is the **idempotency + reconciliation key** (see table below).

**201 response:**

```json
{
  "interview_id": "uuid",
  "invite_link": "https://<candidate-web>/<invite-token> | null",
  "status": "invited",
  "idempotent_replay": false
}
```

**Idempotency:** replays with the same `(org, external_ref, kit_version)` return the *same* interview with `idempotent_replay: true` and `invite_link: null` — safe to retry creates on network failure. Uniqueness enforced by `external_interview_identity_unique (org_id, external_ref, kit_version_id)`.

### `GET /v1/interviews/:id` — poll status (`interviews:read`)

```json
{
  "id": "uuid",
  "status": "invited | started | completed | expired   (from invite.status)",
  "mode": "text | voice | video | human",
  "candidate": { "external_ref": "your-id" },
  "created_at": "ISO-8601",
  "completed_at": "ISO-8601 | null"
}
```

Poll this until `status == "completed"`, then fetch the scorecard. (Webhooks, §4, push the same transition.)

### `GET /v1/interviews/:id/scorecard` — the result (`interviews:read`)

```json
{
  "schema_version": "v1",
  "interview_id": "uuid",
  "candidate": { "external_ref": "your-id" },
  "report": { …evaluation_report row as returned to the employer UI… },
  "scores": [ …evaluation_score rows… ],
  "evidence_spans": [ …evaluation_evidence_span rows… ],
  "overrides": [ …evaluation_override rows… ],
  "recommendation": "strong_yes | yes | maybe | no | strong_no | null"
}
```

Score semantics (shared by every report in the system):

- `overall_recommendation` / per-criterion `score`: **1–5 smallint** (5 best). `overall_confidence`: numeric 0–1.
- Every score **must cite evidence**: `evaluation_score.evidence_span_ids` is a non-empty array into `evidence_spans` (`quote_text` + character offsets into the answer). Ungrounded scores are rejected at the schema layer — this is a product invariant, so consumers can trust every number is traceable to something the candidate said.
- `source` per score: `ai` | `ai_prefill` (AI draft adopted by a human) | `human`. `overrides` records every human change (`original_score`, `new_score`, `reason_code`: `false_positive | technical_issue | candidate_explained | confirmed_violation | other`).
- `report.communication_metrics`: `{ "paceWpm": number, "fillerCount": number, "paragraphCount": number, "avgSentenceLength": number }` — delivery-behavior metrics from transcript analysis (pace/fillers only; **no emotion/personality inference, by design**).
- Recommendation mapping is derived from weighted scores in the report payload.

---

## 4. Webhooks (push)

Register endpoints with employer session auth: `POST /webhooks/endpoints` `{ "url": "https://…", "events": ["interview.completed","report.ready"] }` (at least one; only those two event types exist), `GET /webhooks/endpoints`, `POST /webhooks/endpoints/:id/deactivate`. Ops: `GET /webhooks/deliveries` (filterable), `POST /webhooks/deliveries/:id/replay`.

**Delivery:** `POST` to your URL, headers:

```
x-zios-signature: t={unixSeconds},v1={hmac_sha256(secret, "{t}.{rawBody}")}
```

Verify: rebuild `hmac_sha256(endpoint_secret, "{t}.{rawBody}")` over the **raw body bytes** and constant-time compare the `v1` part; reject timestamps older than 5 minutes. Payload shape:

```json
{
  "event": "interview.completed | report.ready",
  "occurred_at": "ISO-8601",
  "interview_id": "uuid",
  "org_id": "uuid",
  "data": { …event-specific payload (session/report summary)… }
}
```

Retries with backoff (`webhook_delivery.attempts`, `next_attempt_at`); deduped per `(endpoint_id, session_event_id)` — at-least-once delivery, idempotent on your side by `interview_id + event`.

---

## 5. Employer session API (Bearer employer session)

Grouped by module. All paths relative to the API base. `:id` = uuid unless noted.

### Auth & org — `POST /auth/otp/request` `{email}` · `POST /auth/otp/verify` `{email, code}` → `{ user, session: { token, expiresAt } }` · `POST /auth/logout` · `GET /auth/me` · `GET /auth/google` (+ `/google/callback`) · `POST /orgs/current/invites` · `POST /orgs/current/invites/accept` · `GET /orgs/current/members`

OTP codes: 6-digit, 10-minute expiry, 5-attempt cap, hashed at rest (`otp_code`, `audience: 'user'`). First login for an email bootstraps the org (plan `free`, seeded credits).

### Kits (interview definitions) — `/kits`

| Route | Purpose |
|---|---|
| `POST /kits` · `GET /kits` · `GET /kits/:id` · `PATCH /kits/:id` · `PATCH /kits/:id/settings` | CRUD. `settings`: `{ mode: text\|voice\|video, language, logo_url, intro_text, outro_text, proctoring_level: none\|standard\|strict, total_time_cap_sec }` |
| `POST /kits/:id/publish` | Freezes a `kit_version` snapshot (immutable from here on) |
| `GET /kits/:id/versions` · `GET /kits/:id/versions/:v` · `PATCH/PUT/DELETE …/versions/:v` | Version management |
| `POST /kits/:id/questions` · `GET …/questions` · `PATCH …/questions/:qid` · `DELETE …/questions/:qid` · `POST …/questions/reorder` · `POST …/questions/from-bank` | Question authoring |
| `GET /kits/:id/duration-estimate` · `POST /kits/:id/preview-token` · `PATCH /kits/:id/topics` | Utilities |
| `GET /preview/:token` | Candidate-side kit preview (public) |

Question shape: `{ type: open_ended|mcq_single|mcq_multi|rating_scale, prompt, topic, difficulty: easy|medium|hard, time_limit_sec, time_limit_type: soft|hard, mandatory, followup_policy: none|fixed|adaptive_ai, followup_fixed, followup_depth_cap 1–3 (required for adaptive_ai), rubric_lines: [{id, text, weight}], options (MCQ, ≥2), source: manual|jd_generated|bank|external_api }`. `question_bank_item` = the reusable org-wide bank; `/bank/questions` lists it.

### JD generation — `/generation`

`POST /generation/analyze` `{ jd_text }` → role profile · `POST /generation/propose` → question proposal (state in `jd_generation`) · `GET /generation/:id` · `POST /generation/:id/regenerate` · `POST /generation/:id/publish` (draft → kit). State: `analyzing → proposed → published | failed`.

### Invites & candidates — `/invites`

`POST /invites` · `POST /invites/bulk` · `GET /invites` · `GET /invites/:id` · `POST /invites/:id/reissue` (new token, old dies) · `POST /invites/:id/reschedule` · `POST /invites/-/reminders/run` (ops cron).

Candidate side (public): `GET /invites/by-token/:token` (session + status, no PII beyond name), `POST …/otp/request|verify` (if `otp_required`), `POST …/consent` `{ name, email }` → creates `interview_session` + `consent_record`, returns `{ session, recoveryToken }` — **the recovery token drives everything live from here**. `GET /invites/unsubscribe`.

### Interview session (conductor state machine) — `/sessions/:id`

State machine: `invited → consented → preflight → live → scoring → reported → reviewed`, with `completed` and `abandoned` terminal-ish states (see `interview_session_status_check`). Every transition emits a `session_event` row.

| Route | Contract |
|---|---|
| `POST /sessions/:id/preflight` | `{ deviceChecks?, … }` → consent-gated transition to `live`, charges org credits, returns first `turn` |
| `POST /sessions/:id/turn` | **The interview engine.** Body `{ answer?, answerData? }` + `x-recovery-token`. Returns `{ session, turn, webhookDeliveries }`. `turn: { type: question\|followup\|wrapup, text, questionId }`. Empty/omitted answer re-asks the current question; an answer is recorded, the conductor produces the next turn; when done, `session.status` becomes `completed` and evaluation is enqueued. |
| `POST /sessions/:id/abandon` · `POST /sessions/:id/recover` | Exit / resume |
| `GET /sessions/:id` | Session detail |

### Voice mode — `/sessions/:id/voice`

All public (auth = `x-recovery-token`): `POST …/token` → LiveKit token + orchestrator WS URL · `POST …/fallback` (voice→text degrade) · `POST …/telemetry` (per-turn latency `turn` + optional `recording` object reference → stores `lastVoiceTelemetry` in `preflight_report`, enqueues `analysis_job` on the recording).

### Async video interviews — `/async-video-interviews`

Employer creates: `POST /async-video-interviews` · review: `GET :sessionId/review` · score: `POST :sessionId/questions/:questionId/score` · scorecard: `POST :sessionId/scorecard/prefill|submit` · `POST :sessionId/refund` · DLQ ops: `POST dlq/:transcriptId/redrive`. Candidate side: `POST by-token/:token/consent` · `GET :sessionId/questions` · `POST :sessionId/questions/:questionId/video` (upload answer video).

### Human-facilitated live rooms — `/invites/:id/schedule|reschedule|…`, `/sessions/:id/live/*`

Scheduling: `POST /invites/:id/schedule` · `GET …/schedule` · `POST …/reschedule/confirm` · candidate `POST /invites/by-token/:token/reschedule-request` · `GET /invites/:id/ics` (calendar file). Live room: `POST /sessions/:id/live/token` (candidate) · `…/interviewer-token` · `GET …/live/cockpit` · `POST …/live/coverage` · `POST …/live/end`.

### Evaluation & reports — `/reports`, `/dashboard`, `/sessions/:id/integrity`

`GET /reports` (list, filterable) · `GET /reports/:sessionId` (full report: report + scores + evidence spans + notes + overrides + integrity) · `POST /reports/:sessionId/scores/:scoreId/override` · `POST /reports/:sessionId/scorecard/prefill|scorecard` (human scorecard) · `POST /reports/:sessionId/share` (→ share link) · `GET /reports/share/:token` (public read via share link). Dashboard aggregates: `GET /dashboard/interviews`. Integrity: `POST /sessions/:id/integrity/events` (public, from candidate browser: `webcam_snapshot|tab_switch|fullscreen_exit|paste_attempt`), `GET …/flags`, `POST …/flags/:flagId/disposition` (human disposition — **AI never auto-rejects**), ID upload: `POST|GET|DELETE …/id-upload`.

### Consent (standalone) — `/consents` · Credits — `/credits`

`POST /consents` `{ subject_id, purpose, notice_version, artifact_uri? }` (generic consent capture; interview consent normally rides the invite flow) · `GET /consents/:id`. `GET /credits/wallet` (org balance + ledger) · `PATCH /credits/wallet/threshold` (low-balance alert threshold).

---

## 6. Candidate (Ascend) API — Bearer candidate session

Auth: `POST /cand/auth/otp/request|verify` → `{ session: { token }, account }` · `POST /cand/auth/logout`. Profile: `GET|PATCH /cand/me` · `GET /cand/wallet` (candidate credit wallet). History: `GET /cand/me/history` — every interview (Meridian sessions matched by email + Ascend practice sessions) with `reportAvailable` flags.

Resume: `POST /cand/resume` (multipart PDF) · `GET /cand/resume` · `DELETE` · `POST /cand/resume/match` (JD match against parsed resume).

### Practice engine — `/cand/practice`

Sessions: `GET /cand/practice/library` (packs) · `POST /cand/practice` `{ packId, mode: text|voice|live }` · `POST /cand/practice/from-jd` · `GET /cand/practice/progress` · `GET /cand/practice/readiness` · `GET /cand/practice/:id`. Lifecycle: `POST :id/consent` `{ recordingAllowed, model_opt_in }` → `POST :id/preflight` (idempotent, atomic credit claim — live mode costs 3 credits) · turn: `POST :id/turn` (text) or `POST :id/turn-audio` (base64 audio ≤25 MB → orchestrator STT → transcript; the "record answer" flow) · `POST :id/live/token` (LiveKit + orchestrator) · `POST :id/abandon|recover` · `GET :id/report`.

Conductor (used by the orchestrator, recovery-token-only): `POST /cand/practice/conductor/:id/turn` `{ answer }` → `{ session, turn }` · `POST …/telemetry`.

Practice state machine: `created → consented → preflight → live → scoring → reported → reviewed` (+`completed`, `abandoned`); `mode: text|voice|live`, `source: library|jd`.

---

## 7. AI orchestrator (`:8000`) — internal, documented for completeness

Not for external integration; the `api` service is the gateway. Listed so dashboards understand where AI artifacts originate.

| Route | Contract |
|---|---|
| `GET /healthz` · `GET /analysis/health` · `GET /video/health/transcription` · `GET /documents/health/extraction` | Liveness/adapter health (`stt_adapter`, `tts_adapter` in body) |
| `POST /voice/sessions/:id/token` | `{ recoveryToken, mode?, practice? }` → LiveKit JWT + `orchestrator.wsUrl` |
| `WS /voice/sessions/:id/stream` | Multi-turn control socket (below) |
| `POST /video/transcribe` | `object_name` (MinIO) → `{ transcript }` (ffmpeg → STT) |
| `POST /analysis/video` | `{ objectName, … }` → multimodal feature extraction (schema-versioned result) |
| `POST /documents/extract-text` | `{ objectName }` → `{ text }` (PDF/DOCX resume parsing) |

**Voice WS protocol.** Client → server: `start_turn`, `audio_chunk {data: hex PCM16 mono 16 kHz}`, `end_turn`, `barge_in`, `fallback_to_text`. Server → client per turn: `stt_partial*` → `stt_final` → `ai_text` → `tts_audio {audio_base64, text}`* → `backchannel` → `telemetry {turnIndex, vadMs, sttFinalMs, plannerMs, ttsFirstAudioMs, totalTurnMs, transcript, bargedIn, degradationRung}`, then `awaiting_answer` or `interview_complete` (socket closes). `*`: partials only from streaming STT (GCP STT is buffered: one final per turn, no partials). `degradationRung`: `null | tts_text | stt_text | ai_pause` — graceful-degradation ladder. First bootstrap turn is `start_turn`+`end_turn` with no audio (re-asks the current question with TTS).

Adapters are env-selected at boot (loud failure on bad values): `STT_ADAPTER=mock|gcp` (GCP Speech-to-Text v2), `TTS_ADAPTER=mock|piper` (local neural TTS, 24 kHz wire), `LLM_MODE=mock|gemini`, `DOCUMENT_EXTRACTION_ADAPTER=mock|pypdf`. Media objects: recordings under `recordings/<sessionId>…` (WAV) / `captures/…` (WebM) / `practice-recordings/…` / `ids/…` / `resumes/…` in the S3 bucket — **the DB stores only object names + checksums**.

---

## 8. Database schema (complete)

49 tables, grouped by bounded context. Every table has `id uuid PK` + `created_at timestamptz not null default now()` unless noted (omitted from column lists for brevity — they exist everywhere). `→` marks foreign keys. Status/membership vocabularies are verbatim from `CHECK` constraints.

### 8.1 Identity, orgs & access

**`org`** — a tenant (employer company).
`name text` · `plan text not null` (free|paid — app-level) · `credits_balance int not null default 0` (denormalized wallet; ledger is source of truth) · `low_balance_threshold int default 5`.

**`app_user`** — employer-side users. → `org`.
`email citext unique` · `name` · `role: admin | interviewer` (CHECK).

**`org_invite`** — invites to join an org. → `org`, `invited_by → app_user`.
`email` · `role: admin|interviewer` · `token_hash unique` · `expires_at` · `accepted_at`.

**`session`** — employer browser sessions. → `user → app_user`.
`token_hash unique` · `last_seen_at` · `expires_at` · `revoked_at`.

**`otp_code`** — login codes. `email` · `code_hash` · `salt` · `attempts int` · `expires_at` · `consumed_at` · `audience: user | candidate`.

**`api_key`** — partner Integration API keys. → `org`, `created_by → app_user`.
`kind: test | live` · `key_hash unique` (sha256 of the raw key) · `prefix` (display, e.g. `zios_live_a1b2`) · `label` · `scopes text[] default {interviews:read, interviews:write}` · `rate_limit_per_min int default 120` · `rotated_at` · `revoked_at`.

**`email_opt_out`** — `email citext PK` · `unsubscribed_at`.

### 8.2 Candidates & accounts

**`candidate`** — a Meridian interviewee (org-scoped). → `org`, `candidate_account → candidate_account (nullable, set-null)`.
`name` · `email citext` · `phone` · `external_ref` (**partner's system id — the reconciliation key**) · `pii_vault_ref` (reserved for external PII vaulting; null today — PII lives in-table).

**`candidate_account`** — an Ascend login identity (cross-org, email-keyed).
`email citext unique` · `phone unique` · `name default ''` · `target_role` · `onboarding jsonb` · `marketing_opt_in bool default false` · `last_login_at`.

**`candidate_session`** — Ascend bearer sessions. → `account`. `token_hash unique` · `last_seen_at` · `expires_at` · `revoked_at`.

**`candidate_otp`** — per-invite candidate verification. → `invite`. `code_hash` · `attempts` · `expires_at` · `consumed_at`.

**`candidate_resume`** — one resume per account (`UNIQUE(account_id)`). → `account`.
`file_key` (MinIO object) · `file_name` · `content_type default application/pdf` · `parsed jsonb` (extracted text/structure) · `ats_report jsonb` (parsed JD-match report).

**`candidate_id_upload`** — proctored ID documents (encrypted). → `candidate`, → `interview_session`.
`encrypted_uri` · `checksum_algorithm default sha256` · `checksum_value` · `deleted_at` (GDPR-style erasure).

### 8.3 Kits, questions & generation

**`kit`** — an interview definition (draft → publish). → `org`, `created_by → app_user`, `jd_generation → jd_generation (nullable)`.
`title` · `role` · `level` · `status: draft | published | archived` · `settings jsonb` — `{ mode: text|voice|video, language, logo_url, intro_text, outro_text, proctoring_level: none|standard|strict, total_time_cap_sec >0 }` (JSONB fields CHECK-constrained) · `jd_ref` · `generation_metadata jsonb`.

**`kit_version`** — immutable published snapshot (`UNIQUE(kit_id, version)`). → `kit`, `published_by → app_user`.
`version int` · `snapshot jsonb` (full frozen kit + questions; what invites/reports bind to) · `published_at`. **Reports and invites always reference the version, never the mutable draft** — auditability invariant.

**`question`** — kit questions. → `kit`.
`topic default 'General'` · `position` (order; stored as text ordinal) · `type: open_ended | mcq_single | mcq_multi | rating_scale` · `prompt` · `options jsonb` (MCQ only, ≥2, else NULL — CHECK) · `difficulty: easy|medium|hard` · `time_limit_sec >0` · `time_limit_type: soft|hard` · `mandatory bool default true` · `followup_policy: none|fixed|adaptive_ai` (`adaptive_ai` requires `type=open_ended` and `followup_depth_cap` 1–3) · `followup_fixed jsonb` · `followup_depth_cap` · `rubric_lines jsonb` (`[{id, text, weight}]` — the evaluation criteria) · `source: manual|jd_generated|bank|external_api` · `source_ref`.

**`question_bank_item`** — org-wide reusable bank. `role_family` · `topic` · `type` (same CHECKs) · `difficulty` · `prompt` · `options` · `rubric_lines` · `tags text[]`.

**`role_based_questions`** + **`role_based_question_sync_log`** — bulk-imported external question catalog (`UNIQUE(role_id, question_number)`; `external_id`, `question_text`, `experience_target`, `synced_at`…) and its sync audit (`rows_read/written/deleted`, `dry_run`, `status`). Ops plumbing, not interview data.

**`jd_generation`** — JD → kit generation runs. → `org`, `kit → kit (nullable)`.
`jd_hash` (dedupe of identical JDs) · `prompt_version` · `status: analyzing | proposed | published | failed` · `role_profile jsonb` · `proposal jsonb` (question proposal + edits) · `edits jsonb` · `error_message`.

### 8.4 Interview lifecycle (Meridian)

**`invite`** — a sent interview link. → `org`, `kit_version`, `candidate`.
`token_hash unique` · `expires_at` · `otp_required bool` · `otp_verified_at` · `status: invited | started | completed | expired` · `conductor: ai | human` · `metadata jsonb` (e.g. `{source: 'api_v1', mode, proctoringLevel}`) · `reminder_48h_sent_at` / `reminder_4h_sent_at`.

**`interview_session`** — one candidate's attempt. → `invite`, `kit_version`, `consent → consent_record (nullable)`.
`mode: text | voice | video` · `conductor: ai | human` · `status: invited | consented | preflight | live | completed | abandoned | scoring | reported | reviewed` · `consent_id` · `preflight_report jsonb` (device checks; `lastVoiceTelemetry` from the orchestrator) · `started_at` · `ended_at` · `media_refs jsonb default []` (S3 objects: recording WAV/WebM) · `integrity_events jsonb default []` · `schema_version int default 1` · `recovery_token_hash unique` · `livekit_room_name` · `fallback_to_text_at`. **`recovery_token_hash` is the only credential that can drive turns** — treat as a secret.

**`interview_slot`** — scheduling for human-conductor rooms (`UNIQUE(invite_id)`). → `org`, `invite`, `session (nullable)`.
`slot_at` · `timezone default UTC` · `interviewer_ids uuid[]` · `status: scheduled | rescheduled | cancelled` · `reschedule_requested_at` · `reschedule_reason` · `requested_slot_at` · `ics_sent_at`.

**`consent_record`** — the consent artifact (captured **before any media**, invariant). → `session`/`invite` (both nullable, set-null).
`subject_id` (email or account id) · `purpose` · `notice_version` (which consent text was shown) · `captured_at` · `artifact_uri` (signed PDF/screenshot) · `withdrawn_at` · `notice_text` (verbatim text shown).

**`session_transcript`** — the Q&A record; the analytical core. → `session`.
`question_id` (references the frozen snapshot id; text, not FK — snapshots are immutable) · `question_prompt` (verbatim as asked, incl. follow-ups) · `answer_text` (nullable until answered) · `answer_data jsonb` (structured answers for mcq/rating) · `position int` (chronological) · `evidence_span jsonb default []` · `answered_at`. One row per question *ask*, so follow-ups of the same question are separate rows sharing `question_id`.

**`session_event`** — the audit log / outbox. → `session`. `type` (e.g. `session.created`, `session.turn_answered`, `interview.completed`) · `payload jsonb` · `occurred_at`. Webhooks fan out from here.

**`session_coverage`** — human-live rooms: which questions were covered (`UNIQUE(session_id, question_id)`). → `session`, `marked_by → app_user`. `status: pending | covered | skipped`.

**`transcription_job`** (+ **`transcription_job_dlq`**) — async STT queue for video answers. → `session_transcript`. `object_name` · `status: pending | running | completed | failed` · `result text` · `attempts` · timestamps. DLQ mirror for poisoned jobs with `POST …/dlq/:id/redrive`.

### 8.5 Voice/AI pipeline

**`analysis_job`** (+ **`analysis_job_dlq`**) — multimodal analysis of recordings. → `interview_session`.
`kind: transcription | multimodal_feature_extraction` · `status: pending | running | completed | failed | cancelled` · `question_id`/`invite_id` nullable · `payload jsonb` (input: object name, options) · `result jsonb` (output: transcript segments with word timings, delivery features — pace/pauses/fillers, gaze/posture aggregates; `schema_version` names its shape) · `attempts` · `error_code`/`error_message`. DLQ: `UNIQUE(job_id)` + redrive endpoint.

**`interview_session.preflight_report->lastVoiceTelemetry`** (not a table — JSONB): per-turn `{ turnIndex, vadMs, sttFinalMs, plannerMs, ttsFirstAudioMs, totalTurnMs, transcript, bargedIn, degradationRung }`.

### 8.6 Evaluation & reports

**`evaluation_report`** — one per session (`UNIQUE(session_id)`). → `org`, `session`, `invite (nullable)`, `kit_version`, `notes → interview_notes (nullable)`.
`status: pending | completed | failed` · `overall_recommendation smallint 1–5` · `overall_confidence numeric 0–1` · `communication_metrics jsonb` — `{ paceWpm, fillerCount, paragraphCount, avgSentenceLength }` · `rubric_version` · `model_route` (which judge produced it) · `prompt_versions jsonb` (reproducibility) · `cost numeric` (LLM spend) · `scorecard_meta jsonb` · `started_at`/`completed_at` · `error_message`.

**`evaluation_score`** — per-criterion scores (`CHECK: score 1–5, evidence_span_ids non-empty`). → `report`.
`question_id` · `criterion_id`/`criterion_text` (from the question's rubric line) · `score smallint` · `weight numeric` · `evidence_span_ids uuid[]` (**≥1 required — evidence-linked scoring invariant**) · `source: ai | ai_prefill | human` · `scorer_id → app_user (nullable)`.

**`evaluation_evidence_span`** — quotable transcript slices. → `report`, `transcript → session_transcript (nullable, set-null)`.
`question_id` · `start`/`end` (**character offsets into `session_transcript.answer_text`**) · `quote_text`.

**`evaluation_override`** — human corrections. → `report`, `score`. `original_score`/`new_score (1–5)` · `reason_code: false_positive | technical_issue | candidate_explained | confirmed_violation | other` · `reason_text` · `created_by`.

**`interview_notes`** — AI/human session summary. → `session`. `summary` · `question_mapping jsonb` · `generated_by: ai | human` · `generated_at`.

**`evaluation_pipeline_log`** — timing/stage audit. → `session`/`report`. `stages jsonb` · `total_ms`.

**`async_video_review_score`** — async-video human scoring (`UNIQUE(session_id, question_id)`). → `session`. `score 1–5 nullable` · `remarks` · `source: human | ai_prefill` · `reviewed_by`/`scorer_id → app_user`.

**`integrity_flag`** — proctoring flags; **a human must disposition every flag — AI never auto-rejects**. → `session`.
`signal: webcam_snapshot | tab_switch | fullscreen_exit | paste_attempt | long_silence | background_voice` · `occurred_at` · `evidence jsonb` (e.g. snapshot metadata — not raw images) · `disposition: pending | dismissed | confirmed` · `disposition_reason_code` (nullable, 5-value vocab above) · `disposition_reason_text` · `dispositioned_by` · `dispositioned_at`.

**`report_share_link`** — public report links. → `report`. `token_hash unique` · `expires_at` · `access_count` · `last_accessed_at`.

### 8.7 Credits & billing

**`credit_account`** — a wallet (`holder_type: org | candidate`, `holder_id`). `balance int` · `low_balance_threshold default 5`. Org wallets also mirrored on `org.credits_balance`.

**`credit_ledger`** — append-only double-entry-ish history (source of truth). → `account`, `org (nullable)`, `session_ref → interview_session (nullable)`.
`delta int` (negative = debit) · `balance_after int` · `reason` (e.g. `practice_live`, `interview_session`, `admin_grant`, `signup_bonus`) · `metadata jsonb`.

Pricing (app constants): practice live mode = **3 credits**; text/voice = fewer; org interviews debited at preflight. All debits are atomic claims (race-safe).

### 8.8 Ascend practice

**`practice_session`** — a practice/mock run. → `account`, `credit_account`.
`mode: text | voice | live` · `source: library | jd` · `title` · `snapshot jsonb` (frozen question pack, like `kit_version.snapshot`) · `status: created | invited | consented | preflight | live | completed | abandoned | scoring | reported | reviewed` · `consent_id` · `recovery_token_hash` · `started_at` · `completed_at`.

**`practice_consent`** — consent gate before practice capture. → `session`, `account`. `recording_allowed` · `model_opt_in bool default false` · `text_version` · `ip` · `user_agent`.

**`practice_transcript`** — same shape as `session_transcript`: → `session`; `question_id`, `question_prompt`, `answer_text`, `answer_data`, `position`, `evidence_span jsonb`, `answered_at`.

**`practice_report`** (`UNIQUE(session_id)`) → `session`, `account`. Same evaluation shape as `evaluation_report`: `status`, `overall_recommendation 1–5`, `overall_confidence 0–1`, `communication_metrics`, `rubric_version`, `model_route`, `cost`, `coaching_tips jsonb` — `[{ tip, category (pace|structure|…), quoteText, questionId }]` (tips cite the exact answer quote), `coaching_tips_cost`.

**`practice_report_score`** / **`practice_report_evidence_span`** — mirrors of the evaluation pair (same invariants: score 1–5, non-empty evidence, character offsets into `practice_transcript.answer_text`).

### 8.9 Integrations

**`external_interview`** — partner API idempotency + mapping. → `org`, `kit_version`, `invite`. `external_ref` (**your id**). `UNIQUE(org_id, external_ref, kit_version_id)`.

**`webhook_endpoint`** → `org`. `url` · `secret` (HMAC key) · `events text[]` (non-empty subset of `interview.completed`, `report.ready`) · `active bool`.

**`webhook_delivery`** — outbox rows (`UNIQUE(endpoint_id, session_event_id)` → dedup). → `endpoint`, `session_event`. `event` · `payload jsonb` (what was sent) · `status: pending | delivered | failed` · `attempts` · `next_attempt_at` · `last_response_code` · `last_error` · `delivered_at`.

---

## 9. What the platform generates and saves (data flow cheat sheet)

**One Meridian interview** produces: `invite` (+token, OTP rows if gated) → `interview_session` (+ recovery token, events) → `consent_record` (before any capture) → N× `session_transcript` (every question + follow-up asked, verbatim prompts, answers) → `session_event` audit trail → media in S3 (`media_refs`: WAV/WebM recording; voice turns also leave `lastVoiceTelemetry`) → `analysis_job` (transcription + multimodal features: word timings, pace, pauses, fillers, gaze/posture) → `evaluation_report` + `evaluation_score` + `evidence_spans` (AI judge, evidence-cited) → optional `evaluation_override`, human `scorecard`, `report_share_link` → `webhook_delivery` to your endpoint. Proctored runs add `integrity_flag` rows (human-dispositioned) and possibly `candidate_id_upload`.

**One Ascend practice** produces the parallel practice chain: `practice_session` → `practice_consent` → `practice_transcript[]` → `practice_report` (+ scores, evidence spans, coaching tips) + `credit_ledger` debit. Live practice additionally exercises the same LiveKit + orchestrator + recording path as a company interview.

**Implications for a dashboard consuming this data:**
- Join interviews to results via `interview_session` (`invite_id` → `candidate`, `external_ref`); reports land asynchronously — drive off `evaluation_report.status` / `report.ready` webhooks, not polling alone.
- Never join on mutable kit state — always `kit_version.snapshot`.
- Transcript offsets (`evidence_span.start/end`) are **character** offsets into `answer_text` (UTF-16 in JS; treat as code-point-safe).
- Media bytes are never in Postgres; resolve `media_refs`/`object_name` against the S3 bucket with the platform's storage credentials.
- Integrity `disposition=pending` means "needs a human"; only `confirmed` flags should count against a candidate, and even then the score stands unless overridden (`evaluation_override`).
- Credits: read `credit_ledger` for truth, `credit_account.balance` for current state; `org.credits_balance` is a mirror.

---

## 10. Changelog discipline

Schema changes ship via `infra/migrations/migrations/*_<name>.js` (node-pg-migrate), expand-migrate-contract — never destructive in one release. JSONB payloads are versioned where they cross service boundaries (`analysis_job.schema_version`, `evaluation_report.rubric_version`, `prompt_versions`). If you build against this document, pin the HEAD hash above and diff migrations for drift.
