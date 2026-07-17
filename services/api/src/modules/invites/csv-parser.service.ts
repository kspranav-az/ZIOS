import { Injectable } from '@nestjs/common';
import Papa from 'papaparse';

export interface CsvRow {
  name?: string;
  email?: string;
  phone?: string;
  externalRef?: string;
}

export interface ParsedCsvRow {
  row: number;
  data: CsvRow;
  errors: string[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class CsvParserService {
  parse(buffer: Buffer): Promise<ParsedCsvRow[]> {
    return new Promise((resolve, reject) => {
      const results: ParsedCsvRow[] = [];
      Papa.parse<CsvRow>(buffer.toString('utf-8'), {
        header: true,
        skipEmptyLines: true,
        step: (row, parser) => {
          const data = (row.data ?? {}) as CsvRow;
          const errors = this.validateRow(data);
          results.push({ row: results.length + 1, data, errors });
          if (results.length > 10_000) {
            // Safety valve for accidental abuse.
            parser.abort();
            reject(new Error('CSV exceeds maximum row count'));
          }
        },
        complete: () => resolve(results),
        error: (error: Error) => reject(error),
      });
    });
  }

  private validateRow(data: CsvRow): string[] {
    const errors: string[] = [];
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!name) errors.push('name is required');
    if (!email) errors.push('email is required');
    else if (!EMAIL_PATTERN.test(email)) errors.push('email is invalid');
    return errors;
  }
}
