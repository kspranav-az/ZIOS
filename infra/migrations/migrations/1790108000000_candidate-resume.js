/**
 * Phase 12, Branch 4 — candidate resume (D10).
 *
 * One active resume per candidate account: re-upload replaces the row
 * (unique account_id) and the old MinIO object is deleted. The raw file lives
 * in object storage at resumes/{accountId}/{uuid}; parsed profile and the
 * ATS-readiness report are cached jsonb columns so reads never re-run tasks.
 */
exports.up = (pgm) => {
  pgm.createTable('candidate_resume', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    account_id: { type: 'uuid', notNull: true, unique: true },
    file_key: { type: 'text', notNull: true },
    file_name: { type: 'text', notNull: true },
    content_type: { type: 'text', notNull: true, default: 'application/pdf' },
    parsed: { type: 'jsonb', notNull: false },
    ats_report: { type: 'jsonb', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('candidate_resume', ['account_id'], { unique: true });
};

exports.down = (pgm) => {
  pgm.dropTable('candidate_resume');
};
