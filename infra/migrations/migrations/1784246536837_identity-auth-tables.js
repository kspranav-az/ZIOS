/**
 * Phase 01 identity & auth tables: otp_code, session, org_invite
 * (FR-E1-1 email+OTP sign-in, FR-E1-2 sessions/roles, FR-E1-3 invites).
 *
 * Expand-migrate-contract: purely additive — new tables and indexes only.
 *
 * Security shape:
 *  - OTP codes and session/invite tokens are stored HASHED, never in clear;
 *    the raw values live only in the email and the client.
 *  - `otp_code` is keyed by email (pre-tenant: no org exists before signup).
 *  - `session.token_hash` / `org_invite.token_hash` are unique; raw tokens are
 *    32 crypto-random bytes, so sha256 needs no salt for them.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('otp_code', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'citext', notNull: true },
    code_hash: { type: 'text', notNull: true },
    salt: { type: 'text', notNull: true },
    attempts: { type: 'integer', notNull: true, default: 0 },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Latest-code-per-email lookups (issue cooldown + verify) scan by email.
  pgm.createIndex('otp_code', ['email', 'created_at'], { name: 'otp_code_email_created_at_idx' });

  pgm.createTable('session', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('session', 'user_id', { name: 'session_user_id_idx' });

  pgm.createTable('org_invite', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    email: { type: 'citext', notNull: true },
    role: { type: 'text', notNull: true },
    token_hash: { type: 'text', notNull: true, unique: true },
    invited_by: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'CASCADE' },
    expires_at: { type: 'timestamptz', notNull: true },
    accepted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'org_invite',
    'org_invite_role_check',
    "CHECK (role IN ('admin', 'interviewer'))",
  );
  // At most one pending invite per (org, email); re-inviting replaces it.
  pgm.createIndex('org_invite', ['org_id', 'email'], {
    name: 'org_invite_one_pending_per_email',
    unique: true,
    where: 'accepted_at IS NULL',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('org_invite');
  pgm.dropTable('session');
  pgm.dropTable('otp_code');
};
