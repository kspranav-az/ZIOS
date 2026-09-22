/**
 * Org webhook endpoints + durable delivery journal (Phase 10, FR-E13-4).
 *
 * webhook_endpoint: one row per subscriber URL. Secret is stored plaintext
 * (like API keys' HMAC secrets need it for signing; it is shown once at
 * creation and rotatable by deactivating + recreating).
 *
 * webhook_delivery: one row per (endpoint, session_event) — the journal.
 * The unique constraint is the dedupe guarantee: re-emitting the same
 * session_event never creates a second delivery. Failed rows are never
 * deleted; they are replayed via the admin redrive endpoint.
 *
 * Expand-migrate-contract: purely additive.
 */

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('webhook_endpoint', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'org', onDelete: 'CASCADE' },
    url: { type: 'text', notNull: true },
    secret: { type: 'text', notNull: true },
    events: { type: 'text[]', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint(
    'webhook_endpoint',
    'webhook_endpoint_events_check',
    "CHECK (events <@ ARRAY['interview.completed','report.ready']::text[] AND cardinality(events) > 0)",
  );

  pgm.createIndex('webhook_endpoint', 'org_id', { name: 'webhook_endpoint_org_idx' });

  pgm.createTable('webhook_delivery', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    endpoint_id: {
      type: 'uuid',
      notNull: true,
      references: 'webhook_endpoint',
      onDelete: 'CASCADE',
    },
    session_event_id: {
      type: 'uuid',
      notNull: true,
      references: 'session_event',
      onDelete: 'CASCADE',
    },
    event: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    status: { type: 'text', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_response_code: { type: 'integer' },
    last_error: { type: 'text' },
    delivered_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint(
    'webhook_delivery',
    'webhook_delivery_status_check',
    "CHECK (status IN ('pending','delivered','failed'))",
  );

  pgm.addConstraint(
    'webhook_delivery',
    'webhook_delivery_dedupe_unique',
    'UNIQUE (endpoint_id, session_event_id)',
  );

  pgm.createIndex('webhook_delivery', ['endpoint_id', 'status'], {
    name: 'webhook_delivery_endpoint_status_idx',
  });
  pgm.createIndex('webhook_delivery', 'next_attempt_at', {
    name: 'webhook_delivery_next_attempt_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('webhook_delivery');
  pgm.dropTable('webhook_endpoint');
};
