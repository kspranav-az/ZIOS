/**
 * Phase 09 — Human-Facilitated Mode
 * (PRD E8 FR-E8-1…E8-5, E5 FR-E5-5, §15).
 *
 * Expand-only: scheduling, coverage tracking, interview notes, and human
 * scorecard attribution. No destructive changes.
 */

const SLOT_STATUSES = "('scheduled','rescheduled','cancelled')";
const COVERAGE_STATUSES = "('pending','covered','skipped')";
const NOTE_GENERATORS = "('ai','human')";
const SCORE_SOURCES = "('ai','ai_prefill','human')";

/** @type {import('node-pg-migrate').MigrationBuilder['up']} */
exports.up = async (pgm) => {
  // -------------------------------------------------------------------------
  // Scheduling: one slot per invite for a human-facilitated interview.
  // -------------------------------------------------------------------------
  pgm.createTable('interview_slot', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'org', onDelete: 'CASCADE' },
    invite_id: {
      type: 'uuid',
      notNull: true,
      references: 'invite',
      onDelete: 'CASCADE',
      unique: true,
    },
    session_id: { type: 'uuid', references: 'interview_session', onDelete: 'SET NULL' },
    slot_at: { type: 'timestamptz', notNull: true },
    timezone: { type: 'text', notNull: true, default: 'UTC' },
    interviewer_ids: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'::uuid[]") },
    status: { type: 'text', notNull: true, default: 'scheduled' },
    reschedule_requested_at: { type: 'timestamptz' },
    reschedule_reason: { type: 'text' },
    requested_slot_at: { type: 'timestamptz' },
    ics_sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'interview_slot',
    'interview_slot_status_check',
    `CHECK (status IN ${SLOT_STATUSES})`,
  );
  pgm.createIndex('interview_slot', 'org_id', { name: 'interview_slot_org_id_idx' });
  pgm.createIndex('interview_slot', 'invite_id', { name: 'interview_slot_invite_id_idx' });
  pgm.createIndex('interview_slot', 'session_id', { name: 'interview_slot_session_id_idx' });

  // -------------------------------------------------------------------------
  // Coverage tracking: which kit questions the interviewer covered/skippped.
  // -------------------------------------------------------------------------
  pgm.createTable('session_coverage', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    question_id: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    marked_by: { type: 'uuid', references: 'app_user', onDelete: 'SET NULL' },
    marked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'session_coverage',
    'session_coverage_status_check',
    `CHECK (status IN ${COVERAGE_STATUSES})`,
  );
  pgm.addConstraint(
    'session_coverage',
    'session_coverage_session_question_unique',
    'UNIQUE (session_id, question_id)',
  );
  pgm.createIndex('session_coverage', 'session_id', { name: 'session_coverage_session_id_idx' });

  // -------------------------------------------------------------------------
  // Interview notes: post-call summary + question-wise mapping.
  // -------------------------------------------------------------------------
  pgm.createTable('interview_notes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    session_id: {
      type: 'uuid',
      notNull: true,
      references: 'interview_session',
      onDelete: 'CASCADE',
    },
    summary: { type: 'text', notNull: true },
    question_mapping: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    generated_by: { type: 'text', notNull: true, default: 'ai' },
    generated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'interview_notes',
    'interview_notes_generator_check',
    `CHECK (generated_by IN ${NOTE_GENERATORS})`,
  );
  pgm.createIndex('interview_notes', 'session_id', { name: 'interview_notes_session_id_idx' });

  // -------------------------------------------------------------------------
  // Score attribution: human vs AI, with scorecard audit metadata on reports.
  // -------------------------------------------------------------------------
  pgm.addColumn('evaluation_score', {
    source: { type: 'text', notNull: true, default: 'ai' },
    scorer_id: { type: 'uuid', references: 'app_user', onDelete: 'SET NULL' },
  });
  pgm.addConstraint(
    'evaluation_score',
    'evaluation_score_source_check',
    `CHECK (source IN ${SCORE_SOURCES})`,
  );

  pgm.addColumn('evaluation_report', {
    scorecard_meta: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    notes_id: { type: 'uuid', references: 'interview_notes', onDelete: 'SET NULL' },
  });

  // -------------------------------------------------------------------------
  // Invite conductor: determines whether the session is AI- or human-led.
  // -------------------------------------------------------------------------
  pgm.addColumn('invite', {
    conductor: { type: 'text', notNull: true, default: 'ai' },
  });
  pgm.addConstraint('invite', 'invite_conductor_check', "CHECK (conductor IN ('ai','human'))");
};

/** @type {import('node-pg-migrate').MigrationBuilder['down']} */
exports.down = async (pgm) => {
  pgm.dropColumn('invite', ['conductor']);
  pgm.dropColumn('evaluation_report', ['scorecard_meta', 'notes_id']);
  pgm.dropColumn('evaluation_score', ['source', 'scorer_id']);
  pgm.dropTable('interview_notes');
  pgm.dropTable('session_coverage');
  pgm.dropTable('interview_slot');
};
