/**
 * Phase 02 — Interview Kit Builder & Question Bank (PRD §9: kit, kit_version,
 * question, question_bank_item; FR-E2-1…E2-6, FR-E4-1, FR-E4-3).
 *
 * Expand-migrate-contract: purely additive — new tables, indexes, and one
 * trigger function. No existing table is touched.
 *
 * Shape notes:
 *  - `kit` is the mutable draft head; `kit_version` rows are frozen snapshots
 *    created on publish and protected by an immutability trigger (FR-E2-5).
 *  - `question` rows always belong to the draft head (kit_id); publishing
 *    copies the full definition into the version snapshot, so versions never
 *    join back to live rows.
 *  - `question.position` is a fractional-index string (base-62 digits, plain
 *    lexicographic order) for conflict-safe reordering.
 *  - `question_bank_item` is global reference data (no org_id) — the seeded
 *    internal bank shared by all orgs (FR-E4-1).
 */

const QUESTION_TYPES = "('open_ended','mcq_single','mcq_multi','rating_scale')";

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('kit', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    title: { type: 'text', notNull: true },
    role: { type: 'text' },
    level: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'draft' },
    settings: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func(
        `'{"mode":"text","language":"en","proctoring_level":"none","intro_text":null,"outro_text":null,"logo_url":null,"total_time_cap_sec":1800}'::jsonb`,
      ),
    },
    // Set by JD-based generation (Phase 05); null for manually authored kits.
    jd_ref: { type: 'text' },
    created_by: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // Millisecond-truncated on every write so the ISO round-trip used by the
    // optimistic-concurrency guard compares equal (see kits module).
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'kit',
    'kit_status_check',
    "CHECK (status IN ('draft','published','archived'))",
  );
  pgm.addConstraint(
    'kit',
    'kit_settings_mode_check',
    "CHECK (settings->>'mode' IN ('text','voice','video'))",
  );
  pgm.addConstraint(
    'kit',
    'kit_settings_proctoring_level_check',
    "CHECK (settings->>'proctoring_level' IN ('none','standard','strict'))",
  );
  pgm.addConstraint(
    'kit',
    'kit_settings_total_time_cap_check',
    "CHECK ((settings->>'total_time_cap_sec')::integer > 0)",
  );
  pgm.createIndex('kit', ['org_id', 'status'], { name: 'kit_org_status_idx' });

  pgm.createTable('kit_version', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    kit_id: { type: 'uuid', notNull: true, references: 'kit', onDelete: 'CASCADE' },
    version: { type: 'integer', notNull: true },
    // Full frozen definition: { schemaVersion, kit, questions[], durationEstimateSec }.
    snapshot: { type: 'jsonb', notNull: true },
    published_by: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'CASCADE' },
    published_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('kit_version', 'kit_version_kit_version_unique', 'UNIQUE (kit_id, version)');

  // FR-E2-5: versions are immutable — no UPDATE/DELETE path may exist, and the
  // trigger below makes that hold even for hand-run SQL.
  pgm.sql(`
    CREATE FUNCTION reject_kit_version_mutation() RETURNS trigger AS $fn$
    BEGIN
      RAISE EXCEPTION 'kit_version rows are immutable (FR-E2-5)';
    END;
    $fn$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    CREATE TRIGGER kit_version_immutable
    BEFORE UPDATE OR DELETE ON kit_version
    FOR EACH ROW EXECUTE FUNCTION reject_kit_version_mutation();
  `);

  pgm.createTable('question', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    kit_id: { type: 'uuid', notNull: true, references: 'kit', onDelete: 'CASCADE' },
    topic: { type: 'text', notNull: true, default: 'General' },
    position: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    prompt: { type: 'text', notNull: true },
    options: { type: 'jsonb' },
    difficulty: { type: 'text', notNull: true, default: 'medium' },
    time_limit_sec: { type: 'integer' },
    time_limit_type: { type: 'text', notNull: true, default: 'soft' },
    mandatory: { type: 'boolean', notNull: true, default: true },
    followup_policy: { type: 'text', notNull: true, default: 'none' },
    followup_fixed: { type: 'jsonb' },
    followup_depth_cap: { type: 'integer' },
    rubric_lines: { type: 'jsonb', notNull: true, default: pgm.func(`'[]'::jsonb`) },
    source: { type: 'text', notNull: true, default: 'manual' },
    source_ref: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('question', 'question_type_check', `CHECK (type IN ${QUESTION_TYPES})`);
  pgm.addConstraint(
    'question',
    'question_difficulty_check',
    "CHECK (difficulty IN ('easy','medium','hard'))",
  );
  pgm.addConstraint(
    'question',
    'question_time_limit_type_check',
    "CHECK (time_limit_type IN ('soft','hard'))",
  );
  pgm.addConstraint('question', 'question_time_limit_sec_check', 'CHECK (time_limit_sec > 0)');
  pgm.addConstraint(
    'question',
    'question_followup_policy_check',
    "CHECK (followup_policy IN ('none','fixed','adaptive_ai'))",
  );
  // FR-E2-4: adaptive AI follow-ups always carry a depth cap of 1–3.
  pgm.addConstraint(
    'question',
    'question_adaptive_requires_depth_cap',
    "CHECK (followup_policy <> 'adaptive_ai' OR followup_depth_cap BETWEEN 1 AND 3)",
  );
  // §6.2: adaptive follow-ups apply to open-ended questions only.
  pgm.addConstraint(
    'question',
    'question_adaptive_open_ended_only',
    "CHECK (followup_policy <> 'adaptive_ai' OR type = 'open_ended')",
  );
  pgm.addConstraint(
    'question',
    'question_depth_cap_range',
    'CHECK (followup_depth_cap IS NULL OR followup_depth_cap BETWEEN 1 AND 3)',
  );
  // §6.2: MCQ types need ≥ 2 options; other types carry none (rating_scale is
  // a fixed 1–5 scale, so it has no options column content).
  pgm.addConstraint(
    'question',
    'question_mcq_options_check',
    "CHECK (type NOT IN ('mcq_single','mcq_multi') OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2))",
  );
  pgm.addConstraint(
    'question',
    'question_non_mcq_options_null',
    "CHECK (type IN ('mcq_single','mcq_multi') OR options IS NULL)",
  );
  pgm.addConstraint(
    'question',
    'question_rubric_lines_array',
    "CHECK (jsonb_typeof(rubric_lines) = 'array')",
  );
  pgm.addConstraint(
    'question',
    'question_source_check',
    "CHECK (source IN ('manual','jd_generated','bank','external_api'))",
  );
  pgm.createIndex('question', ['kit_id', 'position'], {
    name: 'question_kit_position_idx',
    unique: true,
  });

  pgm.createTable('question_bank_item', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    role_family: { type: 'text', notNull: true },
    topic: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    difficulty: { type: 'text', notNull: true },
    prompt: { type: 'text', notNull: true },
    options: { type: 'jsonb' },
    rubric_lines: { type: 'jsonb', notNull: true },
    tags: { type: 'text[]', notNull: true, default: pgm.func(`'{}'::text[]`) },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'question_bank_item',
    'question_bank_item_type_check',
    `CHECK (type IN ${QUESTION_TYPES})`,
  );
  pgm.addConstraint(
    'question_bank_item',
    'question_bank_item_difficulty_check',
    "CHECK (difficulty IN ('easy','medium','hard'))",
  );
  pgm.addConstraint(
    'question_bank_item',
    'question_bank_item_mcq_options_check',
    "CHECK (type NOT IN ('mcq_single','mcq_multi') OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2))",
  );
  pgm.addConstraint(
    'question_bank_item',
    'question_bank_item_non_mcq_options_null',
    "CHECK (type IN ('mcq_single','mcq_multi') OR options IS NULL)",
  );
  pgm.addConstraint(
    'question_bank_item',
    'question_bank_item_rubric_lines_array',
    "CHECK (jsonb_typeof(rubric_lines) = 'array')",
  );
  pgm.createIndex('question_bank_item', 'role_family', { name: 'question_bank_item_family_idx' });
  pgm.createIndex('question_bank_item', 'topic', { name: 'question_bank_item_topic_idx' });
  pgm.createIndex('question_bank_item', 'tags', {
    name: 'question_bank_item_tags_idx',
    method: 'gin',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('question_bank_item');
  pgm.dropTable('question');
  pgm.sql('DROP TRIGGER kit_version_immutable ON kit_version;');
  pgm.sql('DROP FUNCTION reject_kit_version_mutation();');
  pgm.dropTable('kit_version');
  pgm.dropTable('kit');
};
