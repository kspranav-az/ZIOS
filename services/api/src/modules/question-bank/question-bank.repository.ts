import { Injectable } from '@nestjs/common';
import type {
  McqOption,
  QuestionBankItem,
  QuestionDifficulty,
  QuestionType,
  RubricLine,
} from '@zios/shared-types';
import { DatabaseService } from '@/modules/database';

export const BANK_PAGE_SIZE = 50;

export interface BankSearchFilters {
  query?: string;
  roleFamily?: string;
  topic?: string;
  type?: QuestionType;
  difficulty?: QuestionDifficulty;
  tag?: string;
  page: number;
}

interface BankRow {
  id: string;
  role_family: string;
  topic: string;
  type: string;
  difficulty: string;
  prompt: string;
  options: McqOption[] | null;
  rubric_lines: RubricLine[];
  tags: string[];
  created_at: Date;
}

export function mapBankRow(row: BankRow): QuestionBankItem {
  return {
    id: row.id,
    roleFamily: row.role_family,
    topic: row.topic,
    type: row.type as QuestionType,
    difficulty: row.difficulty as QuestionDifficulty,
    prompt: row.prompt,
    options: row.options,
    rubricLines: row.rubric_lines,
    tags: row.tags,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS =
  'id, role_family, topic, type, difficulty, prompt, options, rubric_lines, tags, created_at';

/**
 * The question bank is global reference data (no org_id) seeded for all orgs
 * (FR-E4-1), so reads deliberately use plain pool queries — there is no
 * tenant column to scope by. Fail-closed withTenant applies to tenant data.
 */
@Injectable()
export class QuestionBankRepository {
  constructor(private readonly db: DatabaseService) {}

  async search(filters: BankSearchFilters): Promise<{ items: QuestionBankItem[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (clause: string, value: unknown): void => {
      params.push(value);
      where.push(`${clause} $${params.length}`);
    };
    if (filters.query) {
      params.push(`%${filters.query}%`);
      where.push(`(prompt ILIKE $${params.length} OR topic ILIKE $${params.length})`);
    }
    if (filters.roleFamily) push('role_family ILIKE', filters.roleFamily);
    if (filters.topic) push('topic ILIKE', filters.topic);
    if (filters.type) push('type =', filters.type);
    if (filters.difficulty) push('difficulty =', filters.difficulty);
    if (filters.tag) {
      params.push(filters.tag);
      where.push(`$${params.length} = ANY(tags)`);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (filters.page - 1) * BANK_PAGE_SIZE;
    params.push(BANK_PAGE_SIZE, offset);
    const result = await this.db.query(
      `SELECT ${COLUMNS}, count(*) OVER() AS total_count
       FROM question_bank_item
       ${whereClause}
       ORDER BY role_family ASC, topic ASC, id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const rows = result.rows as Array<BankRow & { total_count: string }>;
    const first = rows[0];
    return {
      items: rows.map(mapBankRow),
      total: first ? Number(first.total_count) : 0,
    };
  }

  async findById(id: string): Promise<QuestionBankItem | null> {
    const result = await this.db.query(`SELECT ${COLUMNS} FROM question_bank_item WHERE id = $1`, [
      id,
    ]);
    const row = result.rows[0] as BankRow | undefined;
    return row ? mapBankRow(row) : null;
  }
}
