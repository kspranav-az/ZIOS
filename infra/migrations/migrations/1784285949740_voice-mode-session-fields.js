/**
 * Phase 07 — Voice mode session fields & telemetry
 * (PRD E7 FR-E7-3, FR-E7-5, X6, X8).
 *
 * Expand-migrate-contract: purely additive.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.addColumn('interview_session', {
    livekit_room_name: { type: 'text' },
    fallback_to_text_at: { type: 'timestamptz' },
  });
  pgm.createIndex('interview_session', 'livekit_room_name', {
    name: 'interview_session_livekit_room_name_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropIndex('interview_session', 'livekit_room_name', {
    name: 'interview_session_livekit_room_name_idx',
  });
  pgm.dropColumn('interview_session', 'livekit_room_name');
  pgm.dropColumn('interview_session', 'fallback_to_text_at');
};
