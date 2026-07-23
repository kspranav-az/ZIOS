/**
 * Phase 09 follow-up — structured answers for mcq_single, mcq_multi, and
 * rating_scale questions. Keeps answer_text as the human-readable fallback
 * and adds answer_data for deterministic scoring and display.
 *
 * Expand-migrate-contract: purely additive nullable jsonb column.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.addColumn('session_transcript', {
    answer_data: { type: 'jsonb' },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropColumn('session_transcript', 'answer_data');
};
