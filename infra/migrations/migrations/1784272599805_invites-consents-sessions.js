/**
 * Phase 03 — Invites, Consent Registry & Candidate Text Interview Sessions
 * (PRD E5 FR-E5-1…E5-4, E6 FR-E6-1…E6-6 text mode, E7 FR-E7-1, §10 state machine).
 *
 * Expand-migrate-contract: purely additive. No existing table is altered.
 */

const SESSION_STATUSES =
  "('invited','consented','preflight','live','completed','abandoned','scoring','reported','reviewed')";
const INTERVIEW_MODES = "('text','voice','video')";
const CONDUCTORS = "('ai','human')";
const INVITE_STATUSES = "('invited','started','completed','expired')";

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  // Candidate identity (org-scoped). PII vault reference is deferred.
  pgm.createTable('candidate', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    email: { type: 'citext', notNull: true },
    phone: { type: 'text' },
    external_ref: { type: 'text' },
    pii_vault_ref: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('candidate', ['org_id', 'email'], { name: 'candidate_org_email_idx' });

  // Invite link: one unguessable token per candidate + kit version.
  pgm.createTable('invite', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    kit_version_id: { type: 'uuid', notNull: true, references: 'kit_version', onDelete: 'CASCADE' },
    candidate_id: { type: 'uuid', notNull: true, references: 'candidate', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    otp_required: { type: 'boolean', notNull: true, default: false },
    otp_verified_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'invited' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    reminder_48h_sent_at: { type: 'timestamptz' },
    reminder_4h_sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('invite', 'invite_status_check', `CHECK (status IN ${INVITE_STATUSES})`);
  pgm.createIndex('invite', 'token_hash', { name: 'invite_token_hash_idx' });
  pgm.createIndex('invite', 'org_id', { name: 'invite_org_id_idx' });
  pgm.createIndex('invite', 'candidate_id', { name: 'invite_candidate_id_idx' });

  // Candidate-facing OTP (separate from auth OTP; bound to an invite).
  pgm.createTable('candidate_otp', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    invite_id: { type: 'uuid', notNull: true, references: 'invite', onDelete: 'CASCADE' },
    code_hash: { type: 'text', notNull: true },
    attempts: { type: 'integer', notNull: true, default: 0 },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('candidate_otp', 'invite_id', { name: 'candidate_otp_invite_id_idx' });

  // Global email opt-out for candidate-facing reminders (DPDP-aware).
  pgm.createTable('email_opt_out', {
    email: { type: 'citext', primaryKey: true },
    unsubscribed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Interview session (the state-machine saga).
  pgm.createTable('interview_session', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    invite_id: { type: 'uuid', notNull: true, references: 'invite', onDelete: 'CASCADE' },
    kit_version_id: { type: 'uuid', notNull: true, references: 'kit_version', onDelete: 'CASCADE' },
    mode: { type: 'text', notNull: true },
    conductor: { type: 'text', notNull: true, default: 'ai' },
    status: { type: 'text', notNull: true, default: 'invited' },
    consent_id: { type: 'uuid' },
    preflight_report: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    started_at: { type: 'timestamptz' },
    ended_at: { type: 'timestamptz' },
    media_refs: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    integrity_events: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    schema_version: { type: 'integer', notNull: true, default: 1 },
    recovery_token_hash: { type: 'text', unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'interview_session',
    'interview_session_status_check',
    `CHECK (status IN ${SESSION_STATUSES})`,
  );
  pgm.addConstraint(
    'interview_session',
    'interview_session_mode_check',
    `CHECK (mode IN ${INTERVIEW_MODES})`,
  );
  pgm.addConstraint(
    'interview_session',
    'interview_session_conductor_check',
    `CHECK (conductor IN ${CONDUCTORS})`,
  );
  pgm.createIndex('interview_session', 'invite_id', { name: 'interview_session_invite_id_idx' });
  pgm.createIndex('interview_session', 'recovery_token_hash', {
    name: 'interview_session_recovery_token_hash_idx',
  });

  // Consent artifact registry (X8 audit). FKs added after both tables exist.
  pgm.createTable('consent_record', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: { type: 'uuid' },
    invite_id: { type: 'uuid' },
    subject_id: { type: 'text', notNull: true },
    purpose: { type: 'text', notNull: true },
    notice_version: { type: 'text', notNull: true },
    captured_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    artifact_uri: { type: 'text' },
    withdrawn_at: { type: 'timestamptz' },
  });

  // Session transcript (evidence base for scoring).
  pgm.createTable('session_transcript', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'text', notNull: true },
    question_prompt: { type: 'text', notNull: true },
    answer_text: { type: 'text' },
    position: { type: 'integer', notNull: true },
    evidence_span: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    answered_at: { type: 'timestamptz' },
  });
  pgm.createIndex('session_transcript', ['session_id', 'position'], {
    name: 'session_transcript_session_position_idx',
  });

  // Event store for every state-machine transition and telemetry.
  pgm.createTable('session_event', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    type: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('session_event', ['session_id', 'occurred_at'], {
    name: 'session_event_session_occurred_idx',
  });

  // Deferred FKs to avoid circular creation order between session and consent.
  pgm.addConstraint(
    'interview_session',
    'interview_session_consent_id_fk',
    'FOREIGN KEY (consent_id) REFERENCES consent_record ON DELETE SET NULL',
  );
  pgm.addConstraint(
    'consent_record',
    'consent_record_session_id_fk',
    'FOREIGN KEY (session_id) REFERENCES interview_session ON DELETE SET NULL',
  );
  pgm.addConstraint(
    'consent_record',
    'consent_record_invite_id_fk',
    'FOREIGN KEY (invite_id) REFERENCES invite ON DELETE SET NULL',
  );
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('session_event');
  pgm.dropTable('session_transcript');
  pgm.dropTable('consent_record');
  pgm.dropTable('interview_session');
  pgm.dropTable('email_opt_out');
  pgm.dropTable('candidate_otp');
  pgm.dropTable('invite');
  pgm.dropTable('candidate');
};
