/**
 * Seed a deterministic system app_user for async video interview kit creation.
 *
 * Expand-migrate-contract: purely additive. Uses a deterministic UUID so
 * role-based kit publishing has a stable acting user id.
 */

const ZETHEETA_ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SYSTEM_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.sql(`
    INSERT INTO app_user (id, org_id, email, name, role, created_at)
    VALUES ('${SYSTEM_USER_ID}', '${ZETHEETA_ORG_ID}', 'system@zetheta.local', 'Zetheta System', 'admin', now())
    ON CONFLICT (id) DO NOTHING;
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.sql(`DELETE FROM app_user WHERE id = '${SYSTEM_USER_ID}';`);
};
