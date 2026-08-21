/**
 * External role-based question bank sync tables.
 *
 * Adds a dedicated `role_based_questions` table for the external Neon
 * question feed plus a `role_based_question_sync_log` audit table.
 *
 * Expand-migrate-contract: purely additive. No existing table is touched.
 *
 * Design choices:
 *  - Separate from `question_bank_item` because the external data has a
 *    different shape, refresh cadence, and provenance.
 *  - `role_id` + `question_number` form the stable business key because the
 *    external table is truncated and reloaded (its `id` is not stable).
 *  - Full-refresh sync is safe: questions are copied into kits at use-time,
 *    so no foreign key references this table.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('role_based_questions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    external_id: { type: 'integer' },
    role_id: { type: 'integer', notNull: true },
    role_name: { type: 'text', notNull: true },
    question_number: { type: 'integer', notNull: true },
    difficulty_level: { type: 'text', notNull: true },
    question_type: { type: 'text', notNull: true },
    question_text: { type: 'text', notNull: true },
    experience_target: { type: 'text', notNull: true },
    external_created_at: { type: 'date' },
    external_updated_at: { type: 'timestamptz' },
    synced_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint(
    'role_based_questions',
    'role_based_questions_role_question_unique',
    'UNIQUE (role_id, question_number)',
  );

  pgm.createIndex('role_based_questions', 'role_id', { name: 'role_based_questions_role_id_idx' });
  pgm.createIndex('role_based_questions', 'role_name', {
    name: 'role_based_questions_role_name_idx',
  });

  pgm.createTable('role_based_question_sync_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    source: { type: 'text', notNull: true },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
    rows_read: { type: 'integer', notNull: true, default: 0 },
    rows_written: { type: 'integer', notNull: true, default: 0 },
    rows_deleted: { type: 'integer', notNull: true, default: 0 },
    dry_run: { type: 'boolean', notNull: true, default: false },
    status: { type: 'text', notNull: true }, // 'success' | 'failure' | 'dry_run'
    error_message: { type: 'text' },
  });

  pgm.createIndex('role_based_question_sync_log', 'started_at', {
    name: 'role_based_question_sync_log_started_at_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('role_based_question_sync_log');
  pgm.dropTable('role_based_questions');
};
