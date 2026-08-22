/**
 * Durable queue table for async video-answer transcription jobs.
 *
 * Expand-migrate-contract: purely additive. New table only.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('transcription_job', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    transcript_id: {
      type: 'uuid',
      notNull: true,
      references: 'session_transcript',
      onDelete: 'CASCADE',
    },
    object_name: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    result: { type: 'text' },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint(
    'transcription_job',
    'transcription_job_status_check',
    "CHECK (status IN ('pending','running','completed','failed'))",
  );

  pgm.createIndex('transcription_job', 'transcript_id', {
    name: 'transcription_job_transcript_id_idx',
  });

  pgm.createIndex('transcription_job', ['status', 'created_at'], {
    name: 'transcription_job_pending_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('transcription_job');
};
