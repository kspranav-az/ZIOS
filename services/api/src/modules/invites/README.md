# Candidate invites module

Employer-plane candidate invitations: single create, bulk CSV, list/detail,
reissue, reschedule, OTP gating, reminders, and invite email delivery.

## Routes (employer plane, session-authed)

| Method & path | Purpose |
|---|---|
| `POST /invites` | Create a single invite. Body: `{ kitVersionId, candidate: {name, email, phone?, externalRef?}, expiresInDays?, otpRequired?, conductor?, notify?, metadata? }`. Response `{ invite, candidate, token }` — the **raw token is returned exactly once**. |
| `POST /invites/bulk?kitVersionId=…` | Multipart (`file` field) CSV bulk create. Response `{ total, successes, errors, results[] }`; each success row carries its own raw `token`. |
| `GET /invites` | Roster list (newest first). Each `InviteListItem` joins candidate `{name, email}` and kit `{id, title, version}`; `tokenHash` is never selected. |
| `GET /invites/:id` | Detail: invite + candidate + kit-version summary. |
| `POST /invites/:id/reissue` | Rotates the token (old link dies immediately), refuses `completed` (409). Response again carries the raw token once. |
| `POST /invites/:id/reschedule` | `{ extendDays }` or `{ expiresAt }`. |

Public plane (`by-token`) and reminders cron live in the controller too —
see `docs/external-api-and-data-contract.md` for the full surface.

## Invite email (decision D5)

Every create (default on — opt out with `notify: false`), every reissue
(always — the candidate must receive the replacement link), and every
successful bulk row triggers an invite email through the `EMAIL_SENDER`
port (`modules/notifications/email-sender.port.ts`, Mailpit adapter in
dev, provider-independent).

Hard rules:

- **Never inside the transaction.** The send happens after commit; a
  Mailpit hiccup must never roll back an invite.
- **Always non-fatal.** `InviteEmailService.sendSafely` fire-and-forgets
  and logs a warning on failure — the API response still carries the link
  so the employer can copy it manually.
- **Link format:** `${PUBLIC_CANDIDATE_BASE_URL ?? 'http://localhost:5174'}/?token=<raw token>`.

Because the raw token exists only in the create/reissue response, the UI
shows it copy-once; the roster can never re-display an old link — only
reissue a new one.
