/**
 * Partner-integration interview idempotency (Phase 10, FR-E13-2).
 *
 * One row per (org, partner-external-ref, kit version): a partner ATS retries
 * POST /v1/interviews safely — the unique constraint turns retries into the
 * original interview instead of duplicates.
 *
 * Expand-migrate-contract: purely additive.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('external_interview', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'org', onDelete: 'CASCADE' },
    external_ref: { type: 'text', notNull: true },
    kit_version_id: {
      type: 'uuid',
      notNull: true,
      references: 'kit_version',
      onDelete: 'CASCADE',
    },
    invite_id: { type: 'uuid', notNull: true, references: 'invite', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint(
    'external_interview',
    'external_interview_identity_unique',
    'UNIQUE (org_id, external_ref, kit_version_id)',
  );
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('external_interview');
};
