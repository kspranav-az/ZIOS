import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { KitQuestion, KitSettings, RubricLine } from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { DatabaseService, type Queryable } from '@/modules/database';
import {
  estimateDuration,
  KitsRepository,
  QuestionsRepository,
  positionAfter,
  type QuestionInsert,
} from '@/modules/kits';

interface RoleBasedQuestionRow {
  id: number;
  role_id: number;
  role_name: string;
  question_number: number;
  difficulty_level: string;
  question_type: string;
  question_text: string;
  experience_target: string;
}

const DEFAULT_SETTINGS: KitSettings = {
  mode: 'video',
  language: 'en',
  proctoringLevel: 'none',
  introText: null,
  outroText: null,
  logoUrl: null,
  totalTimeCapSec: 1800,
};

function roleKitTitle(roleName: string): string {
  return `${roleName} — Async Video Interview`;
}

function roleKitTag(roleId: number): string {
  return `role-based:${roleId}`;
}

function defaultRubric(): RubricLine[] {
  return [{ id: randomUUID(), text: 'Depth and relevance of experience', weight: 1 }];
}

function questionHash(rows: RoleBasedQuestionRow[]): string {
  const payload = rows
    .map(
      (r) =>
        `${r.role_id}|${r.question_number}|${r.difficulty_level}|${r.question_type}|${r.question_text}`,
    )
    .join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

@Injectable()
export class RoleKitResolverService {
  constructor(
    private readonly db: DatabaseService,
    private readonly kits: KitsRepository,
    private readonly questions: QuestionsRepository,
  ) {}

  /**
   * Returns the latest published kit version for a role.
   *
   * - If no kit exists for the role, creates one, inserts questions, and publishes.
   * - If a kit exists but the role questions have changed, replaces draft questions
   *   and publishes a new version (old interviews keep their immutable version).
   * - If a kit exists and questions are unchanged, returns the latest published version.
   */
  async resolveKitVersionId(
    orgId: string,
    roleId: number,
    actingUserId: string,
    q: Queryable,
  ): Promise<{ kitId: string; versionId: string; questions: KitQuestion[] }> {
    const roleQuestions = await this.fetchRoleQuestions(roleId, q);
    if (roleQuestions.length === 0) {
      throw new ApiException(404, 'ROLE_QUESTIONS_NOT_FOUND', 'no questions found for this role');
    }

    const existingKit = await this.findRoleKit(orgId, roleId, q);
    const currentHash = questionHash(roleQuestions);

    if (!existingKit) {
      const { kitId, versionId, questions } = await this.createAndPublishKit(
        orgId,
        roleQuestions,
        actingUserId,
        currentHash,
        q,
      );
      return { kitId, versionId, questions };
    }

    const storedHash = (existingKit.generationMetadata as Record<string, unknown>)
      ?.roleQuestionHash as string | undefined;

    if (storedHash === currentHash) {
      const latest = await this.kits.listVersions(existingKit.id, q);
      const version = latest[0];
      if (!version) {
        // Should not happen, but recover by republishing.
        const { versionId, questions } = await this.republishKit(
          orgId,
          existingKit.id,
          roleQuestions,
          actingUserId,
          currentHash,
          q,
        );
        return { kitId: existingKit.id, versionId, questions };
      }
      const fullVersion = await this.kits.findVersion(existingKit.id, version.version, q);
      return {
        kitId: existingKit.id,
        versionId: version.id,
        questions: fullVersion?.snapshot.questions ?? [],
      };
    }

    // Questions changed: replace draft questions and publish a new version.
    await this.replaceDraftQuestions(existingKit.id, roleQuestions, q);
    const { versionId, questions } = await this.publishKit(
      orgId,
      existingKit.id,
      roleQuestions,
      actingUserId,
      currentHash,
      q,
    );
    return { kitId: existingKit.id, versionId, questions };
  }

  private async fetchRoleQuestions(roleId: number, q: Queryable): Promise<RoleBasedQuestionRow[]> {
    const result = await q.query(
      `SELECT id, role_id, role_name, question_number, difficulty_level, question_type,
              question_text, experience_target
       FROM role_based_questions
       WHERE role_id = $1
       ORDER BY question_number ASC`,
      [roleId],
    );
    return result.rows as RoleBasedQuestionRow[];
  }

  private async findRoleKit(orgId: string, roleId: number, q: Queryable) {
    const result = await q.query(
      `SELECT id, org_id, title, role, level, status, settings, jd_ref,
              jd_generation_id, generation_metadata, created_by, created_at, updated_at
       FROM kit
       WHERE org_id = $1 AND generation_metadata->>'roleKitTag' = $2
       ORDER BY created_at DESC LIMIT 1`,
      [orgId, roleKitTag(roleId)],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.mapKitRow(row) : null;
  }

  private mapKitRow(row: Record<string, unknown>) {
    // Minimal mapping for the fields we need.
    return {
      id: row.id as string,
      orgId: row.org_id as string,
      title: row.title as string,
      role: row.role as string | null,
      level: row.level as string | null,
      status: row.status as string,
      settings: row.settings as Record<string, unknown>,
      jdRef: row.jd_ref as string | null,
      jdGenerationId: row.jd_generation_id as string | null,
      generationMetadata: row.generation_metadata as Record<string, unknown>,
      createdBy: row.created_by as string,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }

  private async createAndPublishKit(
    orgId: string,
    roleQuestions: RoleBasedQuestionRow[],
    actingUserId: string,
    hash: string,
    q: Queryable,
  ): Promise<{ kitId: string; versionId: string; questions: KitQuestion[] }> {
    const firstQuestion = roleQuestions[0]!;
    const roleName = firstQuestion.role_name;
    const kit = await this.kits.insert(
      {
        orgId,
        title: roleKitTitle(roleName),
        role: roleName,
        level: null,
        settings: DEFAULT_SETTINGS,
        createdBy: actingUserId,
      },
      q,
    );

    await this.kits.update(
      orgId,
      kit.id,
      {
        generationMetadata: {
          roleKitTag: roleKitTag(firstQuestion.role_id),
          roleId: firstQuestion.role_id,
          roleQuestionHash: hash,
          source: 'role_based_questions',
        },
      },
      undefined,
      q,
    );

    await this.insertRoleQuestions(kit.id, roleQuestions, q);
    const published = await this.publishKit(orgId, kit.id, roleQuestions, actingUserId, hash, q);
    return { kitId: kit.id, versionId: published.versionId, questions: published.questions };
  }

  private async replaceDraftQuestions(
    kitId: string,
    roleQuestions: RoleBasedQuestionRow[],
    q: Queryable,
  ) {
    await q.query('DELETE FROM question WHERE kit_id = $1', [kitId]);
    await this.insertRoleQuestions(kitId, roleQuestions, q);
  }

  private async insertRoleQuestions(
    kitId: string,
    roleQuestions: RoleBasedQuestionRow[],
    q: Queryable,
  ) {
    let lastPosition: string | undefined;
    for (const rq of roleQuestions) {
      const position = positionAfter(lastPosition);
      await this.questions.insert(this.toQuestionInsert(kitId, position, rq), q);
      lastPosition = position;
    }
  }

  private async publishKit(
    orgId: string,
    kitId: string,
    roleQuestions: RoleBasedQuestionRow[],
    actingUserId: string,
    hash: string,
    q: Queryable,
  ): Promise<{ versionId: string; questions: KitQuestion[] }> {
    const kit = await this.kits.lockById(orgId, kitId, q);
    if (!kit) {
      throw new ApiException(404, 'KIT_NOT_FOUND', 'role kit not found');
    }

    const questions = await this.questions.listByKit(kit.id, q);
    const estimate = estimateDuration(questions);
    const versionNumber = (await this.kits.maxVersion(kit.id, q)) + 1;

    const snapshot = {
      schemaVersion: 1 as const,
      kit: {
        id: kit.id,
        title: kit.title,
        role: kit.role,
        level: kit.level,
        settings: kit.settings,
        jdRef: kit.jdRef,
      },
      questions,
      durationEstimateSec: estimate.estimatedSeconds,
    };

    const versionRow = await this.kits.insertVersion(
      { kitId: kit.id, version: versionNumber, snapshot, publishedBy: actingUserId },
      q,
    );

    await this.kits.update(
      orgId,
      kit.id,
      {
        status: 'published',
        generationMetadata: {
          ...kit.generationMetadata,
          roleQuestionHash: hash,
        },
      },
      undefined,
      q,
    );

    return { versionId: versionRow.id, questions };
  }

  private async republishKit(
    orgId: string,
    kitId: string,
    roleQuestions: RoleBasedQuestionRow[],
    actingUserId: string,
    hash: string,
    q: Queryable,
  ) {
    return this.publishKit(orgId, kitId, roleQuestions, actingUserId, hash, q);
  }

  private toQuestionInsert(
    kitId: string,
    position: string,
    rq: RoleBasedQuestionRow,
  ): QuestionInsert {
    return {
      kitId,
      position,
      topic: rq.question_type,
      type: 'open_ended',
      prompt: rq.question_text,
      options: null,
      difficulty: 'hard',
      timeLimitSec: 180,
      timeLimitType: 'soft',
      mandatory: true,
      followupPolicy: 'none',
      followupFixed: null,
      followupDepthCap: null,
      rubricLines: defaultRubric(),
      source: 'external_api',
      sourceRef: String(rq.id),
    };
  }
}
