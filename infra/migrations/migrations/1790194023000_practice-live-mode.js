/**
 * Practice live mode (Phase 12e, Step 2): Ascend practice through the real
 * LiveKit room machinery (orchestrator AI interviewer), alongside the
 * existing text and voice-record modes. The session row only gains the new
 * mode value — the check constraint is dropped and recreated, no data moves.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.dropConstraint('practice_session', 'practice_session_mode_check');
  pgm.addConstraint(
    'practice_session',
    'practice_session_mode_check',
    "CHECK (mode IN ('text', 'voice', 'live'))",
  );
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropConstraint('practice_session', 'practice_session_mode_check');
  pgm.addConstraint(
    'practice_session',
    'practice_session_mode_check',
    "CHECK (mode IN ('text', 'voice'))",
  );
};
