/**
 * Phase 05 — JD-Based Interview Generation (PRD E3 FR-E3-1…E3-6, §8).
 *
 * Expand-migrate-contract: adds the `jd_generation` pipeline artifact table and
 * two audit columns to `kit`. No existing table is altered otherwise.
 */

const JD_GENERATION_STATUSES = "('analyzing','proposed','published','failed')";

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('jd_generation', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    kit_id: { type: 'uuid', references: 'kit', onDelete: 'SET NULL' },
    jd_hash: { type: 'text', notNull: true },
    prompt_version: { type: 'text', notNull: true, default: 'phase05-stub' },
    status: { type: 'text', notNull: true, default: 'analyzing' },
    role_profile: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    proposal: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    edits: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'jd_generation',
    'jd_generation_status_check',
    `CHECK (status IN ${JD_GENERATION_STATUSES})`,
  );
  pgm.createIndex('jd_generation', 'org_id', { name: 'jd_generation_org_id_idx' });
  pgm.createIndex('jd_generation', 'kit_id', { name: 'jd_generation_kit_id_idx' });
  pgm.createIndex('jd_generation', 'jd_hash', { name: 'jd_generation_jd_hash_idx' });

  pgm.addColumn('kit', {
    jd_generation_id: { type: 'uuid', references: 'jd_generation', onDelete: 'SET NULL' },
    generation_metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
  });
  pgm.createIndex('kit', 'jd_generation_id', { name: 'kit_jd_generation_id_idx' });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropIndex('kit', 'jd_generation_id', { name: 'kit_jd_generation_id_idx' });
  pgm.dropColumn('kit', ['jd_generation_id', 'generation_metadata']);
  pgm.dropTable('jd_generation');
};
