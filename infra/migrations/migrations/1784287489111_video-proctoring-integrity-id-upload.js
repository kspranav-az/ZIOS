/**
 * Phase 08 — Video proctoring integrity flags & candidate ID upload
 * (PRD E9 FR-E9-1…E9-4, §13, §16.5).
 *
 * Expand-migrate-contract: purely additive.
 */

const DISPOSITIONS = "('pending','dismissed','confirmed')";
const REASON_CODES =
  "('false_positive','technical_issue','candidate_explained','confirmed_violation','other')";
const SIGNALS =
  "('webcam_snapshot','tab_switch','fullscreen_exit','paste_attempt','long_silence','background_voice')";

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  // Integrity flags derived from session signals; every flag requires human disposition.
  pgm.createTable('integrity_flag', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    signal: { type: 'text', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    evidence: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    disposition: { type: 'text', notNull: true, default: 'pending' },
    disposition_reason_code: { type: 'text' },
    disposition_reason_text: { type: 'text' },
    dispositioned_by: { type: 'uuid', references: 'app_user', onDelete: 'SET NULL' },
    dispositioned_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'integrity_flag',
    'integrity_flag_disposition_check',
    `CHECK (disposition IN ${DISPOSITIONS})`,
  );
  pgm.addConstraint(
    'integrity_flag',
    'integrity_flag_reason_code_check',
    `CHECK (disposition_reason_code IS NULL OR disposition_reason_code IN ${REASON_CODES})`,
  );
  pgm.addConstraint(
    'integrity_flag',
    'integrity_flag_signal_check',
    `CHECK (signal IN ${SIGNALS})`,
  );
  pgm.createIndex('integrity_flag', 'session_id', { name: 'integrity_flag_session_id_idx' });

  // Candidate ID upload: PII-segregated, encrypted at rest, soft-deletable.
  pgm.createTable('candidate_id_upload', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    candidate_id: { type: 'uuid', notNull: true, references: 'candidate', onDelete: 'CASCADE' },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    encrypted_uri: { type: 'text', notNull: true },
    checksum_algorithm: { type: 'text', notNull: true, default: 'sha256' },
    checksum_value: { type: 'text', notNull: true },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });
  pgm.createIndex('candidate_id_upload', 'session_id', {
    name: 'candidate_id_upload_session_id_idx',
  });
  pgm.createIndex('candidate_id_upload', 'candidate_id', {
    name: 'candidate_id_upload_candidate_id_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('candidate_id_upload');
  pgm.dropTable('integrity_flag');
};
