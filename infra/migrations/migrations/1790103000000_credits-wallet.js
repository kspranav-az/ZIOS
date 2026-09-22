/**
 * Credits wallet (Phase 10, FR-E14): per-org low-balance alert threshold.
 *
 * Expand-migrate-contract: additive column with a default; no existing
 * behaviour changes until the wallet UI lands.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.addColumn('org', {
    low_balance_threshold: { type: 'integer', notNull: true, default: 5 },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropColumn('org', 'low_balance_threshold');
};
