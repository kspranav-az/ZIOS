import { Injectable } from '@nestjs/common';
import type {
  FollowupPolicy,
  KitQuestion,
  McqOption,
  QuestionDifficulty,
  QuestionSource,
  QuestionType,
  RubricLine,
  TimeLimitType,
} from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';
import type { WriteOutcome } from './kits.repository';

const TRUNC_NOW = `date_trunc('milliseconds', now())`;

export interface QuestionRow {
  id: string;
  kit_id: string;
  topic: string;
  position: string;
  type: string;
  prompt: string;
  options: McqOption[] | null;
  difficulty: string;
  time_limit_sec: number | null;
  time_limit_type: string;
  mandatory: boolean;
  followup_policy: string;
  followup_fixed: string[] | null;
  followup_depth_cap: number | null;
  rubric_lines: RubricLine[];
  source: string;
  source_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

export function mapQuestionRow(row: QuestionRow): KitQuestion {
  return {
    id: row.id,
    kitId: row.kit_id,
    topic: row.topic,
    position: row.position,
    type: row.type as QuestionType,
    prompt: row.prompt,
    options: row.options,
    difficulty: row.difficulty as QuestionDifficulty,
    timeLimitSec: row.time_limit_sec,
    timeLimitType: row.time_limit_type as TimeLimitType,
    mandatory: row.mandatory,
    followupPolicy: row.followup_policy as FollowupPolicy,
    followupFixed: row.followup_fixed,
    followupDepthCap: row.followup_depth_cap,
    rubricLines: row.rubric_lines,
    source: row.source as QuestionSource,
    sourceRef: row.source_ref,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLUMNS =
  'id, kit_id, topic, position, type, prompt, options, difficulty, time_limit_sec, time_limit_type, mandatory, followup_policy, followup_fixed, followup_depth_cap, rubric_lines, source, source_ref, created_at, updated_at';

export interface QuestionInsert {
  kitId: string;
  topic: string;
  position: string;
  type: QuestionType;
  prompt: string;
  options: McqOption[] | null;
  difficulty: QuestionDifficulty;
  timeLimitSec: number | null;
  timeLimitType: TimeLimitType;
  mandatory: boolean;
  followupPolicy: FollowupPolicy;
  followupFixed: string[] | null;
  followupDepthCap: number | null;
  rubricLines: RubricLine[];
  source: QuestionSource;
  sourceRef: string | null;
}

export type QuestionUpdateFields = Partial<
  Omit<QuestionInsert, 'kitId' | 'position' | 'source' | 'sourceRef'>
>;

@Injectable()
export class QuestionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: QuestionInsert, q: Queryable): Promise<KitQuestion> {
    const result = await q.query(
      `INSERT INTO question (kit_id, topic, position, type, prompt, options, difficulty, time_limit_sec, time_limit_type, mandatory, followup_policy, followup_fixed, followup_depth_cap, rubric_lines, source, source_ref, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15, $16, ${TRUNC_NOW}, ${TRUNC_NOW})
       RETURNING ${COLUMNS}`,
      [
        input.kitId,
        input.topic,
        input.position,
        input.type,
        input.prompt,
        input.options === null ? null : JSON.stringify(input.options),
        input.difficulty,
        input.timeLimitSec,
        input.timeLimitType,
        input.mandatory,
        input.followupPolicy,
        input.followupFixed === null ? null : JSON.stringify(input.followupFixed),
        input.followupDepthCap,
        JSON.stringify(input.rubricLines),
        input.source,
        input.sourceRef,
      ],
    );
    return mapQuestionRow(result.rows[0] as QuestionRow);
  }

  async listByKit(kitId: string, q: Queryable = this.db): Promise<KitQuestion[]> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM question WHERE kit_id = $1 ORDER BY position ASC`,
      [kitId],
    );
    return (result.rows as QuestionRow[]).map(mapQuestionRow);
  }

  async findById(kitId: string, id: string, q: Queryable = this.db): Promise<KitQuestion | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM question WHERE id = $1 AND kit_id = $2`, [
      id,
      kitId,
    ]);
    const row = result.rows[0] as QuestionRow | undefined;
    return row ? mapQuestionRow(row) : null;
  }

  async update(
    kitId: string,
    id: string,
    fields: QuestionUpdateFields,
    expectedUpdatedAt: string | undefined,
    q: Queryable,
  ): Promise<WriteOutcome<KitQuestion>> {
    const assignments: string[] = [`updated_at = ${TRUNC_NOW}`];
    const params: unknown[] = [];
    const push = (clause: string, value: unknown): void => {
      params.push(value);
      assignments.push(`${clause} = $${params.length}`);
    };
    const pushJson = (clause: string, value: unknown): void => {
      params.push(JSON.stringify(value));
      assignments.push(`${clause} = $${params.length}::jsonb`);
    };
    if (fields.topic !== undefined) push('topic', fields.topic);
    if (fields.type !== undefined) push('type', fields.type);
    if (fields.prompt !== undefined) push('prompt', fields.prompt);
    if (fields.options !== undefined) {
      if (fields.options === null) push('options', null);
      else pushJson('options', fields.options);
    }
    if (fields.difficulty !== undefined) push('difficulty', fields.difficulty);
    if (fields.timeLimitSec !== undefined) push('time_limit_sec', fields.timeLimitSec);
    if (fields.timeLimitType !== undefined) push('time_limit_type', fields.timeLimitType);
    if (fields.mandatory !== undefined) push('mandatory', fields.mandatory);
    if (fields.followupPolicy !== undefined) push('followup_policy', fields.followupPolicy);
    if (fields.followupFixed !== undefined) {
      if (fields.followupFixed === null) push('followup_fixed', null);
      else pushJson('followup_fixed', fields.followupFixed);
    }
    if (fields.followupDepthCap !== undefined) push('followup_depth_cap', fields.followupDepthCap);
    if (fields.rubricLines !== undefined) pushJson('rubric_lines', fields.rubricLines);
    params.push(id);
    const idParam = params.length;
    params.push(kitId);
    const kitParam = params.length;
    let guard = '';
    if (expectedUpdatedAt !== undefined) {
      params.push(expectedUpdatedAt);
      guard = ` AND updated_at = $${params.length}::timestamptz`;
    }
    const result = await q.query(
      `UPDATE question SET ${assignments.join(', ')} WHERE id = $${idParam} AND kit_id = $${kitParam}${guard} RETURNING ${COLUMNS}`,
      params,
    );
    const updated = result.rows[0] as QuestionRow | undefined;
    if (updated) {
      return { kind: 'ok', value: mapQuestionRow(updated) };
    }
    const current = await this.findById(kitId, id, q);
    return current ? { kind: 'stale', current } : { kind: 'missing' };
  }

  async remove(kitId: string, id: string, q: Queryable): Promise<boolean> {
    const result = await q.query('DELETE FROM question WHERE id = $1 AND kit_id = $2', [id, kitId]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Last position key in display order, or null for an empty kit. */
  async lastPosition(kitId: string, q: Queryable): Promise<string | null> {
    const result = await q.query(
      'SELECT position FROM question WHERE kit_id = $1 ORDER BY position DESC LIMIT 1',
      [kitId],
    );
    const row = result.rows[0] as { position: string } | undefined;
    return row?.position ?? null;
  }

  /** Largest position strictly below `beforePosition` (insert-before support). */
  async previousPosition(
    kitId: string,
    beforePosition: string,
    q: Queryable,
  ): Promise<string | null> {
    const result = await q.query(
      'SELECT position FROM question WHERE kit_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1',
      [kitId, beforePosition],
    );
    const row = result.rows[0] as { position: string } | undefined;
    return row?.position ?? null;
  }

  /** Rebase: writes a full new ordered key set (called inside a transaction). */
  async setPositions(
    kitId: string,
    entries: Array<{ id: string; position: string }>,
    q: Queryable,
  ): Promise<void> {
    // Two-phase write: new keys can equal another row's current key, so first
    // park every row on a unique scratch key, then apply the final keys
    // (avoids transient (kit_id, position) unique violations mid-rebase).
    for (const entry of entries) {
      await q.query('UPDATE question SET position = $1 WHERE id = $2 AND kit_id = $3', [
        `~rebase:${entry.id}`,
        entry.id,
        kitId,
      ]);
    }
    for (const entry of entries) {
      await q.query('UPDATE question SET position = $1 WHERE id = $2 AND kit_id = $3', [
        entry.position,
        entry.id,
        kitId,
      ]);
    }
  }

  async renameTopic(kitId: string, from: string, to: string, q: Queryable): Promise<number> {
    const result = await q.query(
      `UPDATE question SET topic = $1, updated_at = ${TRUNC_NOW} WHERE kit_id = $2 AND topic = $3`,
      [to, kitId, from],
    );
    return result.rowCount ?? 0;
  }
}
