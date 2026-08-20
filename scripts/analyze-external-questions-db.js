#!/usr/bin/env node
/**
 * Analyze the external questions database schema and data.
 *
 * Usage:
 *   EXTERNAL_QUESTIONS_DB_URL="postgresql://..." node scripts/analyze-external-questions-db.js
 */

import { query } from './lib/external-questions-db.js';

async function listTables() {
  const rows = await query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name;
  `);
  return rows;
}

async function getColumns(tableName) {
  const rows = await query(
    `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position;
  `,
    [tableName],
  );
  return rows;
}

async function getIndexes(tableName) {
  const rows = await query(
    `
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = $1;
  `,
    [tableName],
  );
  return rows;
}

async function getConstraints(tableName) {
  const rows = await query(
    `
    SELECT conname, contype, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = $1;
  `,
    [tableName],
  );
  return rows;
}

async function getRowCount(tableName) {
  const rows = await query(`SELECT COUNT(*) AS count FROM "${tableName}";`);
  return Number(rows[0].count);
}

async function getDistinctValues(tableName, column) {
  const rows = await query(
    `
    SELECT "${column}" AS value, COUNT(*) AS count
    FROM "${tableName}"
    GROUP BY "${column}"
    ORDER BY count DESC;
  `,
  );
  return rows;
}

async function getSampleRows(tableName, limit = 5) {
  const rows = await query(`SELECT * FROM "${tableName}" LIMIT $1;`, [limit]);
  return rows;
}

async function main() {
  console.log('External questions database — analysis report\n');

  const tables = await listTables();
  console.log(`Found ${tables.length} user-visible table(s):`);
  for (const t of tables) {
    console.log(`  - ${t.table_schema}.${t.table_name}`);
  }
  console.log();

  // Focus on the interview_questions table that the user shared.
  const targetTable = 'interview_questions';
  const hasTarget = tables.some((t) => t.table_schema === 'public' && t.table_name === targetTable);

  if (!hasTarget) {
    console.warn(`Target table "${targetTable}" was not found in the database.`);
    return;
  }

  console.log(`=== Table: ${targetTable} ===\n`);

  const [columns, indexes, constraints, rowCount] = await Promise.all([
    getColumns(targetTable),
    getIndexes(targetTable),
    getConstraints(targetTable),
    getRowCount(targetTable),
  ]);

  console.log(`Row count: ${rowCount}\n`);

  console.log('Columns:');
  for (const c of columns) {
    const nullable = c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const defaultValue = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    console.log(`  - ${c.column_name}: ${c.data_type} ${nullable}${defaultValue}`);
  }
  console.log();

  if (indexes.length) {
    console.log('Indexes:');
    for (const i of indexes) {
      console.log(`  - ${i.indexname}`);
    }
    console.log();
  }

  if (constraints.length) {
    console.log('Constraints:');
    for (const c of constraints) {
      const type =
        { p: 'PRIMARY KEY', u: 'UNIQUE', f: 'FOREIGN KEY', c: 'CHECK' }[c.contype] || c.contype;
      console.log(`  - ${c.conname} (${type})${c.definition ? `: ${c.definition}` : ''}`);
    }
    console.log();
  }

  // Distribution analysis for key categorical columns.
  const categoricalColumns = [
    'role_name',
    'difficulty_level',
    'question_type',
    'experience_target',
  ];
  for (const col of categoricalColumns) {
    if (columns.some((c) => c.column_name === col)) {
      const values = await getDistinctValues(targetTable, col);
      console.log(`Distinct values for "${col}" (${values.length}):`);
      for (const v of values.slice(0, 10)) {
        console.log(`  - ${v.value ?? '(null)'}: ${v.count}`);
      }
      if (values.length > 10) {
        console.log(`  ... and ${values.length - 10} more`);
      }
      console.log();
    }
  }

  // Numeric range for question_number.
  const numberRange = await query(
    `SELECT MIN(question_number) AS min, MAX(question_number) AS max FROM "${targetTable}";`,
  );
  console.log(`question_number range: ${numberRange[0].min} → ${numberRange[0].max}\n`);

  // Sample rows.
  const samples = await getSampleRows(targetTable, 3);
  console.log('Sample rows (3):');
  for (const row of samples) {
    console.log(
      `  - id=${row.id}, role=${row.role_name}, #${row.question_number}, ` +
        `difficulty=${row.difficulty_level}, type=${row.question_type}, ` +
        `target=${row.experience_target}`,
    );
    console.log(
      `    text: ${String(row.question_text).slice(0, 140)}${String(row.question_text).length > 140 ? '...' : ''}`,
    );
  }
}

main().catch((err) => {
  console.error('\n❌ Analysis failed:', err.message);
  process.exit(1);
});
