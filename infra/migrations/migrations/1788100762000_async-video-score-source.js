/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.addColumn('async_video_review_score', {
    source: { type: 'text', notNull: true, default: 'human' },
    scorer_id: { type: 'uuid', references: 'app_user', onDelete: 'SET NULL' },
  });

  pgm.addConstraint(
    'async_video_review_score',
    'async_video_review_score_source_check',
    "CHECK (source IN ('human', 'ai_prefill'))",
  );
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropConstraint('async_video_review_score', 'async_video_review_score_source_check');
  pgm.dropColumn('async_video_review_score', ['source', 'scorer_id']);
};
