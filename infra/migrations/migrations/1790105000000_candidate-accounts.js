/**
 * Candidate accounts (Phase 12, D7/D8): the Ascend candidate app gets its own
 * account + session stack, fully separated from the employer tenant stack.
 *
 * - otp_code gains an `audience` discriminator ('user' | 'candidate') so the
 *   same email can hold codes for both products without cross-validation.
 * - candidate_session mirrors `session` (opaque hashed bearer tokens).
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('candidate_account', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'citext', notNull: true, unique: true },
    phone: { type: 'text', unique: true },
    name: { type: 'text', notNull: true, default: pgm.func("''") },
    target_role: { type: 'text' },
    onboarding: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    marketing_opt_in: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_login_at: { type: 'timestamptz' },
  });

  pgm.addColumn('otp_code', {
    audience: { type: 'text', notNull: true, default: 'user' },
  });
  pgm.addConstraint('otp_code', 'otp_code_audience_check', "CHECK (audience IN ('user', 'candidate'))");

  pgm.createTable('candidate_session', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: { type: 'uuid', notNull: true, references: 'candidate_account', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('candidate_session', 'account_id', { name: 'candidate_session_account_id_idx' });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('candidate_session');
  pgm.dropConstraint('otp_code', 'otp_code_audience_check');
  pgm.dropColumn('otp_code', 'audience');
  pgm.dropTable('candidate_account');
};
