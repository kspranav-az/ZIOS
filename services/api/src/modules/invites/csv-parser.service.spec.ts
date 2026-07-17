import { describe, expect, it } from 'vitest';
import { CsvParserService } from './csv-parser.service';

describe('CsvParserService', () => {
  const parser = new CsvParserService();

  it('parses a valid CSV and flags missing emails', async () => {
    const csv = Buffer.from('name,email,phone\nAlice,alice@example.com,\nBob,,12345');
    const rows = await parser.parse(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.errors).toHaveLength(0);
    expect(rows[1]?.errors).toContain('email is required');
  });

  it('flags invalid emails', async () => {
    const csv = Buffer.from('name,email\nAlice,not-an-email');
    const rows = await parser.parse(csv);
    expect(rows[0]?.errors).toContain('email is invalid');
  });

  it('handles at least 500 rows', async () => {
    const lines = ['name,email'];
    for (let i = 0; i < 500; i += 1) {
      lines.push(`Candidate ${i},candidate${i}@example.com`);
    }
    const rows = await parser.parse(Buffer.from(lines.join('\n')));
    expect(rows).toHaveLength(500);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
  });
});
