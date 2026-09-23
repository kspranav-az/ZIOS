/**
 * Candidate interview history (Phase 12e, Step 3): link employer-side
 * candidate rows to Ascend candidate accounts by exact email match
 * (citext comparison — case-insensitive but never fuzzy), so a candidate
 * who interviewed with a company can see those sessions in Ascend's
 * Progress page. Links are maintained lazily by GET /cand/me/history and
 * backfilled here for existing rows. ON DELETE SET NULL: deleting an
 * Ascend account must not touch employer data, and vice versa.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.addColumn('candidate', {
    candidate_account_id: {
      type: 'uuid',
      references: 'candidate_account(id)',
      onDelete: 'SET NULL',
    },
  });
  pgm.createIndex('candidate', ['candidate_account_id'], { name: 'candidate_account_link_idx' });
  pgm.sql(`
    UPDATE candidate c
    SET candidate_account_id = ca.id
    FROM candidate_account ca
    WHERE c.candidate_account_id IS NULL AND c.email = ca.email
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropIndex('candidate', ['candidate_account_id'], { name: 'candidate_account_link_idx' });
  pgm.dropColumn('candidate', 'candidate_account_id');
};
