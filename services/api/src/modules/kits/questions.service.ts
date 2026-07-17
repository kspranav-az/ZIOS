import { Injectable } from '@nestjs/common';
import type {
  AppUser,
  CloneFromBankBody,
  CreateQuestionBody,
  FollowupPolicy,
  Kit,
  KitQuestion,
  McqOption,
  QuestionDifficulty,
  QuestionType,
  RubricLine,
  TimeLimitType,
  UpdateQuestionBody,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { DatabaseService, type Queryable } from '@/modules/database';
import { QuestionBankRepository } from '@/modules/question-bank';
import { KitsRepository } from './kits.repository';
import { KitsService } from './kits.service';
import { assignPositions, positionAfter, positionBetween } from './positions';
import { QuestionsRepository, type QuestionInsert } from './questions.repository';
import { validateQuestionShape, type QuestionShape } from './validation';

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function badRequest(errors: string[]): never {
  throw new ApiException(400, 'VALIDATION_ERROR', errors[0] ?? 'invalid question', {
    details: errors,
  });
}

/** Auto-assigns stable per-question ids where the author left them blank. */
function withFallbackIds<T extends { id: string }>(items: T[], prefix: string): T[] {
  return items.map((item, index) =>
    typeof item.id === 'string' && item.id.trim().length > 0
      ? item
      : { ...item, id: `${prefix}${index + 1}` },
  );
}

/**
 * Policy-driven field coercion (autosave-friendly): switching policy/type
 * clears the fields that no longer apply instead of erroring on leftovers.
 */
function coerceShape(shape: QuestionShape): QuestionShape {
  const coerced = { ...shape };
  const isMcq = coerced.type === 'mcq_single' || coerced.type === 'mcq_multi';
  if (!isMcq) {
    coerced.options = null;
  }
  if (coerced.followupPolicy === 'none') {
    coerced.followupFixed = null;
    coerced.followupDepthCap = null;
  } else if (coerced.followupPolicy === 'fixed') {
    coerced.followupDepthCap = null;
  } else if (coerced.followupPolicy === 'adaptive_ai') {
    coerced.followupFixed = null;
  }
  return coerced;
}

@Injectable()
export class QuestionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly kits: KitsRepository,
    private readonly questions: QuestionsRepository,
    private readonly kitsService: KitsService,
    private readonly bank: QuestionBankRepository,
  ) {}

  private async loadEditableKit(orgId: string, kitId: string, q: Queryable): Promise<Kit> {
    const kit = await this.kits.findById(orgId, kitId, q);
    if (!kit) {
      throw new ApiException(404, 'KIT_NOT_FOUND', 'kit not found');
    }
    this.kitsService.assertEditable(kit);
    return kit;
  }

  private toInsert(kitId: string, position: string, shape: QuestionShape): QuestionInsert {
    return {
      kitId,
      position,
      topic: shape.topic.trim(),
      type: shape.type as QuestionType,
      prompt: shape.prompt.trim(),
      options: shape.options,
      difficulty: shape.difficulty as QuestionDifficulty,
      timeLimitSec: shape.timeLimitSec,
      timeLimitType: shape.timeLimitType as TimeLimitType,
      mandatory: shape.mandatory,
      followupPolicy: shape.followupPolicy as FollowupPolicy,
      followupFixed: shape.followupFixed,
      followupDepthCap: shape.followupDepthCap,
      rubricLines: shape.rubricLines,
      source: 'manual',
      sourceRef: null,
    };
  }

  async add(user: AppUser, kitId: string, body: CreateQuestionBody): Promise<KitQuestion> {
    return this.db.withTenant(async (client) => {
      await this.loadEditableKit(user.orgId, kitId, client);

      let position: string;
      if (body?.beforeQuestionId !== undefined) {
        const target = await this.questions.findById(kitId, body.beforeQuestionId, client);
        if (!target) {
          throw new ApiException(404, 'QUESTION_NOT_FOUND', 'beforeQuestionId question not found');
        }
        const previous =
          (await this.questions.previousPosition(kitId, target.position, client)) ?? undefined;
        position = positionBetween(previous, target.position);
      } else {
        const last = (await this.questions.lastPosition(kitId, client)) ?? undefined;
        position = positionAfter(last);
      }

      const shape = coerceShape({
        topic: trimToNull(body?.topic) ?? 'General',
        type: body?.type as string,
        prompt: typeof body?.prompt === 'string' ? body.prompt : '',
        options: Array.isArray(body?.options)
          ? withFallbackIds(body.options as McqOption[], 'o')
          : null,
        difficulty: (body?.difficulty as string) ?? 'medium',
        timeLimitSec: body?.timeLimitSec === undefined ? null : body.timeLimitSec,
        timeLimitType: (body?.timeLimitType as string) ?? 'soft',
        mandatory: body?.mandatory ?? true,
        followupPolicy: (body?.followupPolicy as string) ?? 'none',
        followupFixed: Array.isArray(body?.followupFixed) ? body.followupFixed : null,
        followupDepthCap: body?.followupDepthCap === undefined ? null : body.followupDepthCap,
        rubricLines: Array.isArray(body?.rubricLines)
          ? withFallbackIds(body.rubricLines as RubricLine[], 'r')
          : [],
      });
      const errors = validateQuestionShape(shape);
      // Explicit stray options for a non-MCQ type are a client error; leftover
      // options after a type switch are coerced away silently instead.
      if (
        Array.isArray(body?.options) &&
        body.options.length > 0 &&
        body?.type !== 'mcq_single' &&
        body?.type !== 'mcq_multi'
      ) {
        errors.unshift(`options are only valid for MCQ types, not ${body?.type}`);
      }
      if (errors.length > 0) badRequest(errors);

      const question = await this.questions.insert(this.toInsert(kitId, position, shape), client);
      await this.kits.touchUpdatedAt(kitId, client);
      return question;
    });
  }

  async list(user: AppUser, kitId: string): Promise<KitQuestion[]> {
    return this.db.withTenant(async (client) => {
      // Read path: archived kits stay readable (they are read-only, not hidden).
      const kit = await this.kits.findById(user.orgId, kitId, client);
      if (!kit) {
        throw new ApiException(404, 'KIT_NOT_FOUND', 'kit not found');
      }
      return this.questions.listByKit(kitId, client);
    });
  }

  async update(
    user: AppUser,
    kitId: string,
    questionId: string,
    body: UpdateQuestionBody,
  ): Promise<KitQuestion> {
    return this.db.withTenant(async (client) => {
      await this.loadEditableKit(user.orgId, kitId, client);
      const existing = await this.questions.findById(kitId, questionId, client);
      if (!existing) {
        throw new ApiException(404, 'QUESTION_NOT_FOUND', 'question not found');
      }

      const merged = coerceShape({
        topic: body?.topic !== undefined ? (trimToNull(body.topic) ?? '') : existing.topic,
        type: body?.type ?? existing.type,
        prompt: body?.prompt ?? existing.prompt,
        options:
          body?.options === undefined
            ? existing.options
            : body.options === null
              ? null
              : withFallbackIds(body.options, 'o'),
        difficulty: body?.difficulty ?? existing.difficulty,
        timeLimitSec: body?.timeLimitSec === undefined ? existing.timeLimitSec : body.timeLimitSec,
        timeLimitType: body?.timeLimitType ?? existing.timeLimitType,
        mandatory: body?.mandatory ?? existing.mandatory,
        followupPolicy: body?.followupPolicy ?? existing.followupPolicy,
        followupFixed:
          body?.followupFixed === undefined ? existing.followupFixed : body.followupFixed,
        followupDepthCap:
          body?.followupDepthCap === undefined ? existing.followupDepthCap : body.followupDepthCap,
        rubricLines:
          body?.rubricLines === undefined
            ? existing.rubricLines
            : withFallbackIds(body.rubricLines, 'r'),
      });
      const errors = validateQuestionShape(merged);
      if (
        Array.isArray(body?.options) &&
        body.options.length > 0 &&
        merged.type !== 'mcq_single' &&
        merged.type !== 'mcq_multi'
      ) {
        errors.unshift(`options are only valid for MCQ types, not ${merged.type}`);
      }
      if (errors.length > 0) badRequest(errors);

      const outcome = await this.questions.update(
        kitId,
        questionId,
        {
          topic: merged.topic.trim(),
          type: merged.type as QuestionType,
          prompt: merged.prompt.trim(),
          options: merged.options,
          difficulty: merged.difficulty as QuestionDifficulty,
          timeLimitSec: merged.timeLimitSec,
          timeLimitType: merged.timeLimitType as TimeLimitType,
          mandatory: merged.mandatory,
          followupPolicy: merged.followupPolicy as FollowupPolicy,
          followupFixed: merged.followupFixed,
          followupDepthCap: merged.followupDepthCap,
          rubricLines: merged.rubricLines,
        },
        body?.expectedUpdatedAt,
        client,
      );
      if (outcome.kind === 'missing') {
        throw new ApiException(404, 'QUESTION_NOT_FOUND', 'question not found');
      }
      if (outcome.kind === 'stale') {
        throw new ApiException(
          409,
          'STALE_WRITE',
          'the question was changed since you loaded it — refresh and retry',
          { currentUpdatedAt: outcome.current.updatedAt },
        );
      }
      return outcome.value;
    });
  }

  async remove(user: AppUser, kitId: string, questionId: string): Promise<void> {
    return this.db.withTenant(async (client) => {
      await this.loadEditableKit(user.orgId, kitId, client);
      const deleted = await this.questions.remove(kitId, questionId, client);
      if (!deleted) {
        throw new ApiException(404, 'QUESTION_NOT_FOUND', 'question not found');
      }
      await this.kits.touchUpdatedAt(kitId, client);
    });
  }

  /**
   * FR-E2-1 drag-order: the client sends the full new order and every
   * position is rebased in one transaction — idempotent and conflict-free
   * (two concurrent reorders both produce valid orders; last write wins).
   */
  async reorder(user: AppUser, kitId: string, questionIds: unknown): Promise<KitQuestion[]> {
    if (
      !Array.isArray(questionIds) ||
      questionIds.some((id) => typeof id !== 'string' || id.length === 0)
    ) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'questionIds must be an array of id strings');
    }
    return this.db.withTenant(async (client) => {
      await this.loadEditableKit(user.orgId, kitId, client);
      const current = await this.questions.listByKit(kitId, client);
      const currentIds = new Set(current.map((question) => question.id));
      const requested = questionIds as string[];
      const requestedSet = new Set(requested);
      if (
        requestedSet.size !== requested.length ||
        requestedSet.size !== currentIds.size ||
        !requested.every((id) => currentIds.has(id))
      ) {
        throw new ApiException(
          400,
          'VALIDATION_ERROR',
          'questionIds must list every question of the kit exactly once — reload and retry',
        );
      }
      const positions = assignPositions(requested);
      await this.questions.setPositions(
        kitId,
        requested.map((id) => ({ id, position: positions.get(id) as string })),
        client,
      );
      await this.kits.touchUpdatedAt(kitId, client);
      return this.questions.listByKit(kitId, client);
    });
  }

  async renameTopic(user: AppUser, kitId: string, from: unknown, to: unknown): Promise<number> {
    const fromTopic = trimToNull(from);
    const toTopic = trimToNull(to);
    if (!fromTopic || !toTopic) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'from and to must be non-empty strings');
    }
    return this.db.withTenant(async (client) => {
      await this.loadEditableKit(user.orgId, kitId, client);
      const updated = await this.questions.renameTopic(kitId, fromTopic, toTopic, client);
      if (updated > 0) {
        await this.kits.touchUpdatedAt(kitId, client);
      }
      return updated;
    });
  }

  /** FR-E4-1/E4-3: clone a bank item into the kit with provenance recorded. */
  async cloneFromBank(user: AppUser, kitId: string, body: CloneFromBankBody): Promise<KitQuestion> {
    const bankItemId = trimToNull(body?.bankItemId);
    if (!bankItemId) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'bankItemId is required');
    }
    const item = await this.bank.findById(bankItemId);
    if (!item) {
      throw new ApiException(404, 'BANK_ITEM_NOT_FOUND', 'question bank item not found');
    }
    return this.db.withTenant(async (client) => {
      await this.loadEditableKit(user.orgId, kitId, client);
      const last = (await this.questions.lastPosition(kitId, client)) ?? undefined;
      const question = await this.questions.insert(
        {
          kitId,
          position: positionAfter(last),
          topic: trimToNull(body?.topic) ?? item.topic,
          type: item.type,
          prompt: item.prompt,
          options: item.options,
          difficulty: item.difficulty,
          timeLimitSec: null,
          timeLimitType: 'soft',
          mandatory: true,
          followupPolicy: 'none',
          followupFixed: null,
          followupDepthCap: null,
          rubricLines: item.rubricLines,
          source: 'bank',
          sourceRef: item.id,
        },
        client,
      );
      await this.kits.touchUpdatedAt(kitId, client);
      return question;
    });
  }
}
