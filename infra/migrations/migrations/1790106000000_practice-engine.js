/**
 * Practice engine (Phase 12, D5/D6/D9): the Ascend mock-interview core in its
 * own bounded context. Own tables only — practice data never touches
 * interview_session / kit tables, so the employer-tenant data wall is
 * enforced by construction (rule 3).
 *
 * - practice_session: snapshot jsonb carries the question set (D6) — library
 *   packs are seeded JSON, JD-generated sets land in Branch 4.
 * - practice_report/_score/_evidence_span mirror the evaluation tables' core
 *   shape (D9) so judges, metrics and the report renderer run unchanged.
 */

const SESSION_STATUSES = `('created', 'invited', 'consented', 'preflight', 'live', 'completed', 'abandoned', 'scoring', 'reported', 'reviewed')`;

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  pgm.createTable('practice_session', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: {
      type: 'uuid',
      notNull: true,
      references: 'candidate_account',
      onDelete: 'CASCADE',
    },
    mode: { type: 'text', notNull: true },
    source: { type: 'text', notNull: true },
    title: { type: 'text', notNull: true },
    snapshot: { type: 'jsonb', notNull: true },
    status: { type: 'text', notNull: true, default: 'created' },
    consent_id: { type: 'uuid' },
    credit_account_id: { type: 'uuid', notNull: true, references: 'credit_account' },
    recovery_token_hash: { type: 'text' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('practice_session', 'practice_session_mode_check', "CHECK (mode IN ('text', 'voice'))");
  pgm.addConstraint('practice_session', 'practice_session_source_check', "CHECK (source IN ('library', 'jd'))");
  pgm.addConstraint(
    'practice_session',
    'practice_session_status_check',
    `CHECK (status IN ${SESSION_STATUSES})`,
  );
  pgm.createIndex('practice_session', 'account_id', { name: 'practice_session_account_id_idx' });

  pgm.createTable('practice_consent', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'practice_session',
      onDelete: 'CASCADE',
    },
    account_id: {
      type: 'uuid',
      notNull: true,
      references: 'candidate_account',
      onDelete: 'CASCADE',
    },
    recording_allowed: { type: 'boolean', notNull: true },
    model_opt_in: { type: 'boolean', notNull: true, default: false },
    text_version: { type: 'text', notNull: true },
    ip: { type: 'text' },
    user_agent: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('practice_consent', 'session_id', { name: 'practice_consent_session_id_idx' });

  pgm.createTable('practice_transcript', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'practice_session',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'text', notNull: true },
    question_prompt: { type: 'text', notNull: true },
    answer_text: { type: 'text' },
    answer_data: { type: 'jsonb' },
    position: { type: 'integer', notNull: true },
    evidence_span: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    answered_at: { type: 'timestamptz' },
  });
  pgm.createIndex('practice_transcript', ['session_id', 'position'], {
    name: 'practice_transcript_session_position_idx',
  });

  pgm.createTable('practice_report', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'practice_session',
      onDelete: 'CASCADE',
      unique: true,
    },
    account_id: {
      type: 'uuid',
      notNull: true,
      references: 'candidate_account',
      onDelete: 'CASCADE',
    },
    status: { type: 'text', notNull: true, default: 'pending' },
    overall_recommendation: { type: 'smallint' },
    overall_confidence: { type: 'numeric(3,2)' },
    communication_metrics: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    rubric_version: { type: 'text', notNull: true, default: 'practice-stub' },
    model_route: { type: 'text', notNull: true, default: 'stub-judge' },
    prompt_versions: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    cost: { type: 'numeric(12,6)', notNull: true, default: 0 },
    error_message: { type: 'text' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'practice_report',
    'practice_report_status_check',
    `CHECK (status IN ('pending', 'completed', 'failed'))`,
  );

  pgm.createTable('practice_report_score', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'practice_report',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'text', notNull: true },
    criterion_id: { type: 'text', notNull: true },
    criterion_text: { type: 'text', notNull: true },
    score: { type: 'smallint', notNull: true },
    weight: { type: 'numeric(3,2)', notNull: true },
    evidence_span_ids: { type: 'uuid[]', notNull: true },
  });
  pgm.createIndex('practice_report_score', 'report_id', { name: 'practice_report_score_report_id_idx' });

  pgm.createTable('practice_report_evidence_span', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'practice_report',
      onDelete: 'CASCADE',
    },
    transcript_id: {
      type: 'uuid',
      references: 'practice_transcript',
      onDelete: 'SET NULL',
    },
    question_id: { type: 'text', notNull: true },
    start: { type: 'integer', notNull: true },
    end: { type: 'integer', notNull: true },
    quote_text: { type: 'text', notNull: true },
  });
  pgm.createIndex('practice_report_evidence_span', 'report_id', {
    name: 'practice_report_evidence_span_report_id_idx',
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropTable('practice_report_evidence_span');
  pgm.dropTable('practice_report_score');
  pgm.dropTable('practice_report');
  pgm.dropTable('practice_transcript');
  pgm.dropTable('practice_consent');
  pgm.dropTable('practice_session');
};
