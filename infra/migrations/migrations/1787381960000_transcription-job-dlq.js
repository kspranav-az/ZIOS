/**
 * Add DLQ table for async video transcription jobs and a started_at timestamp.
 *
 * Expand-migrate-contract: purely additive.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.addColumn('transcription_job', {
    started_at: { type: 'timestamptz' },
    attempts: { type: 'integer', notNull: true, default: 0 },
  });

  pgm.createTable('transcription_job_dlq', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    job_id: { type: 'text', notNull: true, unique: true },
    transcript_id: {
      type: 'uuid',
      notNull: true,
      references: 'session_transcript',
      onDelete: 'CASCADE',
    },
    object_name: { type: 'text', notNull: true },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'uuid', notNull: true },
    error_message: { type: 'text' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    failed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('transcription_job_dlq', 'session_id', {
    name: 'transcription_job_dlq_session_id_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('transcription_job_dlq');
  pgm.dropColumn('transcription_job', ['started_at', 'attempts']);
};
