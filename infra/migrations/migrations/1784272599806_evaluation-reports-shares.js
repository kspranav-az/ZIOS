/**
 * Phase 04 — Evaluation Pipeline, Reports, Share Links & Dashboard
 * (PRD E8 FR-E8-1…E8-6, E9 FR-E9-1/E9-2, §11 evidence-linked scoring).
 *
 * Expand-migrate-contract: purely additive. No existing table is altered.
 */

const REPORT_STATUSES = "('pending','completed','failed')";

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  // Evaluation report header: one row per completed interview session.
  pgm.createTable('evaluation_report', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: '"org"', onDelete: 'CASCADE' },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
      unique: true,
    },
    invite_id: { type: 'uuid', references: 'invite', onDelete: 'SET NULL' },
    kit_version_id: { type: 'uuid', notNull: true, references: 'kit_version', onDelete: 'CASCADE' },
    status: { type: 'text', notNull: true, default: 'pending' },
    overall_recommendation: { type: 'smallint' },
    overall_confidence: { type: 'numeric(3,2)' },
    communication_metrics: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    rubric_version: { type: 'text', notNull: true, default: 'phase04-stub' },
    model_route: { type: 'text', notNull: true, default: 'stub-judge' },
    prompt_versions: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    error_message: { type: 'text' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'evaluation_report',
    'evaluation_report_status_check',
    `CHECK (status IN ${REPORT_STATUSES})`,
  );
  pgm.addConstraint(
    'evaluation_report',
    'evaluation_report_recommendation_check',
    'CHECK (overall_recommendation IS NULL OR (overall_recommendation >= 1 AND overall_recommendation <= 5))',
  );
  pgm.addConstraint(
    'evaluation_report',
    'evaluation_report_confidence_check',
    'CHECK (overall_confidence IS NULL OR (overall_confidence >= 0 AND overall_confidence <= 1))',
  );
  pgm.createIndex('evaluation_report', 'org_id', { name: 'evaluation_report_org_id_idx' });
  pgm.createIndex('evaluation_report', 'session_id', { name: 'evaluation_report_session_id_idx' });

  // Per-criterion score. Evidence is mandatory at the schema layer.
  pgm.createTable('evaluation_score', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'evaluation_report',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'text', notNull: true },
    criterion_id: { type: 'text', notNull: true },
    criterion_text: { type: 'text', notNull: true },
    score: { type: 'smallint', notNull: true },
    weight: { type: 'numeric(3,2)', notNull: true },
    evidence_span_ids: { type: 'uuid[]', notNull: true },
  });
  pgm.addConstraint(
    'evaluation_score',
    'evaluation_score_score_check',
    'CHECK (score >= 1 AND score <= 5)',
  );
  pgm.addConstraint(
    'evaluation_score',
    'evaluation_score_evidence_span_ids_check',
    'CHECK (array_length(evidence_span_ids, 1) > 0)',
  );
  pgm.createIndex('evaluation_score', 'report_id', { name: 'evaluation_score_report_id_idx' });

  // Evidence spans: transcript slices cited by scores.
  pgm.createTable('evaluation_evidence_span', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'evaluation_report',
      onDelete: 'CASCADE',
    },
    transcript_id: {
      type: 'uuid',
      references: 'session_transcript',
      onDelete: 'SET NULL',
    },
    question_id: { type: 'text', notNull: true },
    start: { type: 'integer', notNull: true },
    end: { type: 'integer', notNull: true },
    quote_text: { type: 'text', notNull: true },
  });
  pgm.createIndex('evaluation_evidence_span', 'report_id', {
    name: 'evaluation_evidence_span_report_id_idx',
  });
  pgm.createIndex('evaluation_evidence_span', 'transcript_id', {
    name: 'evaluation_evidence_span_transcript_id_idx',
  });

  // Human score overrides (audit trail; original score preserved).
  pgm.createTable('evaluation_override', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'evaluation_report',
      onDelete: 'CASCADE',
    },
    score_id: {
      type: 'uuid',
      notNull: true,
      references: 'evaluation_score',
      onDelete: 'CASCADE',
    },
    original_score: { type: 'smallint', notNull: true },
    new_score: { type: 'smallint', notNull: true },
    reason_code: { type: 'text', notNull: true },
    reason_text: { type: 'text' },
    created_by: { type: 'uuid', references: 'app_user', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'evaluation_override',
    'evaluation_override_new_score_check',
    'CHECK (new_score >= 1 AND new_score <= 5)',
  );
  pgm.createIndex('evaluation_override', 'report_id', {
    name: 'evaluation_override_report_id_idx',
  });

  // Public share links for report viewing.
  pgm.createTable('report_share_link', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'evaluation_report',
      onDelete: 'CASCADE',
    },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    access_count: { type: 'integer', notNull: true, default: 0 },
    last_accessed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('report_share_link', 'token_hash', { name: 'report_share_link_token_hash_idx' });

  // Pipeline execution log for observability and debugging.
  pgm.createTable('evaluation_pipeline_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: { type: 'uuid', references: 'interview_session', onDelete: 'SET NULL' },
    report_id: { type: 'uuid', references: 'evaluation_report', onDelete: 'SET NULL' },
    stages: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    total_ms: { type: 'integer' },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });
  pgm.createIndex('evaluation_pipeline_log', 'session_id', {
    name: 'evaluation_pipeline_log_session_id_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('evaluation_pipeline_log');
  pgm.dropTable('report_share_link');
  pgm.dropTable('evaluation_override');
  pgm.dropTable('evaluation_evidence_span');
  pgm.dropTable('evaluation_score');
  pgm.dropTable('evaluation_report');
};
