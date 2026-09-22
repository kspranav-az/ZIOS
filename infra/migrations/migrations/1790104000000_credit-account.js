/**
 * Credit accounts (Phase 12, D1-D3): generalize the wallet from org-only to
 * holder-typed accounts (`org` | `candidate`) ahead of the Ascend candidate
 * app. The ledger gains account_id; org.credits_balance is kept as a synced
 * cache (D2) and retired in a later phase.
 *
 * Expand-migrate-contract: credit_ledger.account_id lands nullable, is
 * backfilled from per-org accounts, then set NOT NULL. credit_ledger.org_id
 * is relaxed to nullable because candidate-typed ledger rows have no org.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('credit_account', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    holder_type: { type: 'text', notNull: true },
    holder_id: { type: 'uuid', notNull: true },
    balance: { type: 'integer', notNull: true, default: 0 },
    low_balance_threshold: { type: 'integer', notNull: true, default: 5 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint(
    'credit_account',
    'credit_account_holder_type_check',
    "CHECK (holder_type IN ('org', 'candidate'))",
  );
  pgm.createIndex('credit_account', ['holder_type', 'holder_id'], {
    unique: true,
    name: 'credit_account_holder_uq',
  });

  pgm.addColumn('credit_ledger', {
    account_id: { type: 'uuid', references: 'credit_account', onDelete: 'CASCADE' },
  });
  pgm.alterColumn('credit_ledger', 'org_id', { notNull: false });

  // Backfill: one org-typed account per existing org, mirror balances and
  // thresholds, then point every existing ledger row at its account.
  pgm.sql(`
    INSERT INTO credit_account (holder_type, holder_id, balance, low_balance_threshold)
    SELECT 'org', id, credits_balance, low_balance_threshold FROM "org";
  `);
  pgm.sql(`
    UPDATE credit_ledger cl
    SET account_id = ca.id
    FROM credit_account ca
    WHERE ca.holder_type = 'org' AND ca.holder_id = cl.org_id;
  `);
  pgm.sql(`ALTER TABLE credit_ledger ALTER COLUMN account_id SET NOT NULL;`);
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.sql(`ALTER TABLE credit_ledger ALTER COLUMN account_id DROP NOT NULL;`);
  pgm.sql(`UPDATE credit_ledger SET account_id = NULL;`);
  pgm.dropColumn('credit_ledger', 'account_id');
  pgm.dropTable('credit_account');
};
