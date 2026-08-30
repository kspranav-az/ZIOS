/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createTable('credit_ledger', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    delta: { type: 'integer', notNull: true },
    balance_after: { type: 'integer', notNull: true },
    reason: { type: 'text', notNull: true },
    session_ref: { type: 'uuid', references: 'interview_session', onDelete: 'SET NULL' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('credit_ledger', 'org_id', { name: 'credit_ledger_org_id_idx' });
  pgm.createIndex('credit_ledger', 'session_ref', { name: 'credit_ledger_session_ref_idx' });
  pgm.createIndex('credit_ledger', 'created_at', { name: 'credit_ledger_created_at_idx' });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable('credit_ledger');
};
