/**
 * API keys for the partner Integration API (Phase 10, FR-E13-1).
 *
 * Only the sha256 hash of each key is stored; the full key is shown once at
 * creation/rotation. Keys are org-scoped and kinded test|live.
 *
 * Expand-migrate-contract: purely additive.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('api_key', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'org', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true },
    key_hash: { type: 'text', notNull: true, unique: true },
    prefix: { type: 'text', notNull: true },
    label: { type: 'text' },
    scopes: {
      type: 'text[]',
      notNull: true,
      default: pgm.func(`ARRAY['interviews:read','interviews:write']::text[]`),
    },
    rate_limit_per_min: { type: 'integer', notNull: true, default: 120 },
    created_by: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    rotated_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('api_key', 'api_key_kind_check', "CHECK (kind IN ('test','live'))");

  pgm.createIndex('api_key', ['org_id', 'kind'], { name: 'api_key_org_kind_idx' });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('api_key');
};
