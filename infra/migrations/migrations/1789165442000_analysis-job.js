/**
 * Generalized analysis-job lifecycle for multimodal interview feature
 * extraction (Phase 14).
 *
 * `analysis_job` carries a `kind` so one durable queue table serves both
 * legacy-style transcription jobs and multimodal feature extraction. The
 * existing `transcription_job` / `transcription_job_dlq` tables are left
 * untouched: the legacy async-video path keeps working for interviews
 * created with `enableAnalysis: false`.
 *
 * Expand-migrate-contract: purely additive. New tables only.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('analysis_job', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    kind: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'uuid' },
    invite_id: { type: 'uuid' },
    payload: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    result: { type: 'jsonb' },
    schema_version: { type: 'text' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    error_code: { type: 'text' },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint(
    'analysis_job',
    'analysis_job_kind_check',
    "CHECK (kind IN ('transcription','multimodal_feature_extraction'))",
  );

  pgm.addConstraint(
    'analysis_job',
    'analysis_job_status_check',
    "CHECK (status IN ('pending','running','completed','failed','cancelled'))",
  );

  pgm.createIndex('analysis_job', 'session_id', { name: 'analysis_job_session_id_idx' });
  pgm.createIndex('analysis_job', ['status', 'created_at'], { name: 'analysis_job_status_idx' });
  pgm.createIndex('analysis_job', 'kind', { name: 'analysis_job_kind_idx' });

  pgm.createTable('analysis_job_dlq', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    job_id: { type: 'text', notNull: true, unique: true },
    analysis_job_id: {
      type: 'uuid',
      notNull: true,
      references: 'analysis_job',
      onDelete: 'CASCADE',
    },
    kind: { type: 'text', notNull: true },
    session_id: { type: 'uuid', notNull: true },
    question_id: { type: 'uuid' },
    error_code: { type: 'text' },
    error_message: { type: 'text' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    failed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('analysis_job_dlq', 'session_id', { name: 'analysis_job_dlq_session_id_idx' });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('analysis_job_dlq');
  pgm.dropTable('analysis_job');
};
