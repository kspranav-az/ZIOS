/**
 * Add human reviewer scores/remarks for async video interviews.
 *
 * Expand-migrate-contract: purely additive. New table only.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('async_video_review_score', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'text', notNull: true },
    score: { type: 'smallint' },
    remarks: { type: 'text' },
    reviewed_by: { type: 'uuid', references: 'app_user', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint(
    'async_video_review_score',
    'async_video_review_score_score_check',
    'CHECK (score IS NULL OR (score >= 1 AND score <= 5))',
  );

  pgm.addConstraint(
    'async_video_review_score',
    'async_video_review_score_session_question_unique',
    'UNIQUE (session_id, question_id)',
  );

  pgm.createIndex('async_video_review_score', 'session_id', {
    name: 'async_video_review_score_session_id_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('async_video_review_score');
};
