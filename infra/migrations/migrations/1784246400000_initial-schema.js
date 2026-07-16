/**
 * Initial schema: org + app_user (PRD §9; Phase 00 scaffold).
 *
 * Expand-migrate-contract: this migration is purely additive — new tables,
 * new extension, no destructive changes. Later phases extend, never mutate
 * published history.
 *
 * `app_user` (not `user`) avoids the Postgres reserved word and matches the
 * shared-types AppUser contract.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createExtension('citext', { ifNotExists: true });

  pgm.createTable('org', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    plan: { type: 'text', notNull: true },
    credits_balance: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('app_user', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    email: { type: 'citext', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('app_user', 'app_user_role_check', "CHECK (role IN ('admin', 'interviewer'))");
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('app_user');
  pgm.dropTable('org');
  pgm.dropExtension('citext');
};
