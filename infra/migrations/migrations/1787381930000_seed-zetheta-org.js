/**
 * Seed the special "Zetheta" org that owns async video interviews created
 * through the role-based question bank flow.
 *
 * Expand-migrate-contract: purely additive. Uses a deterministic UUID so
 * downstream code and tests can reference ZETHEETA_ORG_ID reliably.
 */

const ZETHEETA_ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.sql(`
    INSERT INTO org (id, name, plan, credits_balance, created_at)
    VALUES ('${ZETHEETA_ORG_ID}', 'Zetheta', 'enterprise', 0, now())
    ON CONFLICT (id) DO NOTHING;
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.sql(`DELETE FROM org WHERE id = '${ZETHEETA_ORG_ID}';`);
};
