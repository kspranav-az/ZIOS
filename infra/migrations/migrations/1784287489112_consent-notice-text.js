/**
 * Phase 08 — Video Mode & Baseline Proctoring
 *
 * Expand-migrate-contract: adds notice_text to consent_record so the exact
 * proctoring-level disclosure shown to the candidate is stored verbatim in
 * the consent artifact (FR-E9-1, X8 audit).
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.addColumn('consent_record', {
    notice_text: { type: 'text' },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropColumn('consent_record', 'notice_text');
};
