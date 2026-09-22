import { Injectable } from '@nestjs/common';
import type {
  AppUser,
  CreateKitBody,
  DurationEstimateResponse,
  GenerationProposal,
  InterviewMode,
  JdProfile,
  Kit,
  KitDetailResponse,
  KitSettings,
  KitSnapshot,
  KitStatus,
  KitVersion,
  KitVersionSummary,
  PreviewResponse,
  PreviewTokenResponse,
  ProctoringLevel,
  ProposedQuestion,
  UpdateKitBody,
  UpdateKitSettingsBody,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { DatabaseService, type Queryable } from '@/modules/database';
import { estimateDuration } from './duration';
import { KitsRepository, type WriteOutcome } from './kits.repository';
import { positionAfter } from './positions';
import {
  PREVIEW_TOKEN_TTL_SECONDS,
  previewTokenSecret,
  signPreviewToken,
  verifyPreviewToken,
} from './preview-tokens';
import { QuestionsRepository } from './questions.repository';
import { validateKitForPublish } from './validation';

const DEFAULT_SETTINGS: KitSettings = {
  mode: 'text',
  language: 'en',
  proctoringLevel: 'none',
  introText: null,
  outroText: null,
  logoUrl: null,
  totalTimeCapSec: 1800,
};

const KIT_STATUSES: readonly KitStatus[] = ['draft', 'published', 'archived'];
const MODES: readonly InterviewMode[] = ['text', 'voice', 'video'];
const PROCTORING_LEVELS: readonly ProctoringLevel[] = ['none', 'standard', 'strict'];

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Validates a settings patch and merges it onto a base (400 on bad input). */
export function mergeSettings(
  base: KitSettings,
  patch: Partial<KitSettings> | undefined,
): KitSettings {
  const merged: KitSettings = { ...base };
  if (!patch || typeof patch !== 'object') return merged;
  if (patch.mode !== undefined) {
    if (!MODES.includes(patch.mode)) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        `settings.mode must be one of ${MODES.join(', ')}`,
      );
    }
    merged.mode = patch.mode;
  }
  if (patch.proctoringLevel !== undefined) {
    if (!PROCTORING_LEVELS.includes(patch.proctoringLevel)) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        `settings.proctoringLevel must be one of ${PROCTORING_LEVELS.join(', ')}`,
      );
    }
    merged.proctoringLevel = patch.proctoringLevel;
  }
  if (patch.language !== undefined) {
    const language = trimToNull(patch.language);
    if (!language) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        'settings.language must be a non-empty string',
      );
    }
    merged.language = language;
  }
  if (patch.totalTimeCapSec !== undefined) {
    if (!Number.isInteger(patch.totalTimeCapSec) || patch.totalTimeCapSec <= 0) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        'settings.totalTimeCapSec must be a positive integer (seconds)',
      );
    }
    merged.totalTimeCapSec = patch.totalTimeCapSec;
  }
  for (const key of ['introText', 'outroText', 'logoUrl'] as const) {
    const value = patch[key];
    if (value !== undefined) {
      if (value !== null && typeof value !== 'string') {
        throw new ApiException(400, 'VALIDATION_ERROR', `settings.${key} must be a string or null`);
      }
      merged[key] = typeof value === 'string' && value.trim().length === 0 ? null : value;
    }
  }
  return merged;
}

@Injectable()
export class KitsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly kits: KitsRepository,
    private readonly questions: QuestionsRepository,
  ) {}

  async create(user: AppUser, body: CreateKitBody): Promise<Kit> {
    const title = trimToNull(body?.title);
    if (!title) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'title is required');
    }
    const settings = mergeSettings(DEFAULT_SETTINGS, body?.settings);
    return this.db.withTenant((client) =>
      this.kits.insert(
        {
          orgId: user.orgId,
          title,
          role: trimToNull(body?.role),
          level: trimToNull(body?.level),
          settings,
          createdBy: user.id,
        },
        client,
      ),
    );
  }

  /**
   * Phase 05 publish hand-off: creates a draft kit from a generation proposal,
   * inserts the proposed questions with `source='jd_generated'` and the
   * generation id as `source_ref`, stamps audit metadata on the kit row, and
   * publishes it as a versioned snapshot.
   */
  async createFromProposal(
    user: AppUser,
    proposal: GenerationProposal,
    profile: JdProfile,
    generationId: string,
    generationMetadata: Record<string, unknown>,
    settingsOverrides?: Partial<KitSettings>,
  ): Promise<{ kit: Kit; version: KitVersionSummary }> {
    return this.db.withTenant(async (client) => {
      const settings = mergeSettings(DEFAULT_SETTINGS, settingsOverrides ?? {});
      const kit = await this.kits.insert(
        {
          orgId: user.orgId,
          title: profile.title ?? 'Generated Interview Kit',
          role: profile.title,
          level: profile.seniority,
          settings,
          createdBy: user.id,
        },
        client,
      );

      let lastPosition: string | undefined;
      for (const proposed of proposal.questions) {
        const position = positionAfter(lastPosition);
        await this.questions.insert(
          this.toQuestionInsert(kit.id, position, proposed, generationId),
          client,
        );
        lastPosition = position;
      }

      const kitWithGen = await this.kits.update(
        user.orgId,
        kit.id,
        { jdGenerationId: generationId, generationMetadata },
        undefined,
        client,
      );
      if (kitWithGen.kind !== 'ok') {
        throw new ApiException(500, 'INTERNAL_ERROR', 'failed to stamp generation metadata on kit');
      }

      const questions = await this.questions.listByKit(kit.id, client);
      const estimate = estimateDuration(questions);
      const errors = validateKitForPublish(kitWithGen.value, questions, estimate.estimatedSeconds);
      if (errors.length > 0) {
        throw new ApiException(
          422,
          'PUBLISH_VALIDATION_FAILED',
          'generated kit cannot be published',
          {
            details: errors,
          },
        );
      }

      const version = (await this.kits.maxVersion(kit.id, client)) + 1;
      const snapshot: KitSnapshot = {
        schemaVersion: 1,
        kit: {
          id: kit.id,
          title: kitWithGen.value.title,
          role: kitWithGen.value.role,
          level: kitWithGen.value.level,
          settings: kitWithGen.value.settings,
          jdRef: kitWithGen.value.jdRef,
        },
        questions,
        durationEstimateSec: estimate.estimatedSeconds,
      };
      const versionRow = await this.kits.insertVersion(
        { kitId: kit.id, version, snapshot, publishedBy: user.id },
        client,
      );
      await this.kits.update(user.orgId, kit.id, { status: 'published' }, undefined, client);
      return { kit: kitWithGen.value, version: versionRow };
    });
  }

  private toQuestionInsert(
    kitId: string,
    position: string,
    proposed: ProposedQuestion,
    generationId: string,
  ): import('./questions.repository').QuestionInsert {
    return {
      kitId,
      position,
      topic: proposed.topic,
      type: proposed.type,
      prompt: proposed.prompt,
      options: proposed.options,
      difficulty: proposed.difficulty,
      timeLimitSec: proposed.timeLimitSec,
      timeLimitType: proposed.timeLimitType,
      mandatory: proposed.mandatory,
      followupPolicy: proposed.followupPolicy,
      followupFixed: proposed.followupFixed,
      followupDepthCap: proposed.followupDepthCap,
      rubricLines: proposed.rubricLines,
      source: 'jd_generated',
      sourceRef: generationId,
    };
  }

  async list(user: AppUser, statusParam: string | undefined): Promise<Kit[]> {
    let status: KitStatus | undefined;
    if (statusParam !== undefined && statusParam !== '') {
      if (!KIT_STATUSES.includes(statusParam as KitStatus)) {
        throw new ApiException(
          400,
          'VALIDATION_ERROR',
          `status must be one of ${KIT_STATUSES.join(', ')}`,
        );
      }
      status = statusParam as KitStatus;
    }
    return this.db.withTenant((client) => this.kits.listByOrg(user.orgId, status, client));
  }

  /** Org-scoped load — cross-tenant ids are indistinguishable from missing. */
  private async loadKit(orgId: string, id: string, q?: Queryable): Promise<Kit> {
    const kit = await this.kits.findById(orgId, id, q);
    if (!kit) {
      throw new ApiException(404, 'KIT_NOT_FOUND', 'kit not found');
    }
    return kit;
  }

  /** Archived kits are read-only until unarchived. */
  assertEditable(kit: Kit): void {
    if (kit.status === 'archived') {
      throw new ApiException(409, 'KIT_ARCHIVED', 'kit is archived — unarchive it before editing');
    }
  }

  async getDetail(user: AppUser, id: string): Promise<KitDetailResponse> {
    return this.db.withTenant(async (client) => {
      const kit = await this.loadKit(user.orgId, id, client);
      const questions = await this.questions.listByKit(kit.id, client);
      const topics = [...new Set(questions.map((question) => question.topic))];
      return { kit, questions, topics };
    });
  }

  private mapWriteOutcome(outcome: WriteOutcome<Kit>): Kit {
    if (outcome.kind === 'missing') {
      throw new ApiException(404, 'KIT_NOT_FOUND', 'kit not found');
    }
    if (outcome.kind === 'stale') {
      throw new ApiException(
        409,
        'STALE_WRITE',
        'the kit was changed since you loaded it — refresh and retry',
        { currentUpdatedAt: outcome.current.updatedAt },
      );
    }
    return outcome.value;
  }

  async update(user: AppUser, id: string, body: UpdateKitBody): Promise<Kit> {
    const fields: { title?: string; role?: string | null; level?: string | null } = {};
    if (body?.title !== undefined) {
      const title = trimToNull(body.title);
      if (!title) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'title must be a non-empty string');
      }
      fields.title = title;
    }
    if (body?.role !== undefined) fields.role = trimToNull(body.role);
    if (body?.level !== undefined) fields.level = trimToNull(body.level);

    return this.db.withTenant(async (client) => {
      const kit = await this.loadKit(user.orgId, id, client);
      this.assertEditable(kit);
      if (Object.keys(fields).length === 0) return kit;
      const outcome = await this.kits.update(
        user.orgId,
        id,
        fields,
        body?.expectedUpdatedAt,
        client,
      );
      return this.mapWriteOutcome(outcome);
    });
  }

  async updateSettings(user: AppUser, id: string, body: UpdateKitSettingsBody): Promise<Kit> {
    return this.db.withTenant(async (client) => {
      const kit = await this.loadKit(user.orgId, id, client);
      this.assertEditable(kit);
      const settings = mergeSettings(kit.settings, body ?? {});
      const outcome = await this.kits.update(
        user.orgId,
        id,
        { settings },
        body?.expectedUpdatedAt,
        client,
      );
      return this.mapWriteOutcome(outcome);
    });
  }

  async archive(user: AppUser, id: string): Promise<Kit> {
    return this.setStatus(user, id, 'archived');
  }

  async unarchive(user: AppUser, id: string): Promise<Kit> {
    return this.db.withTenant(async (client) => {
      const kit = await this.loadKit(user.orgId, id, client);
      if (kit.status !== 'archived') return kit;
      const versions = await this.kits.maxVersion(id, client);
      const status: KitStatus = versions > 0 ? 'published' : 'draft';
      const outcome = await this.kits.update(user.orgId, id, { status }, undefined, client);
      return this.mapWriteOutcome(outcome);
    });
  }

  private async setStatus(user: AppUser, id: string, status: KitStatus): Promise<Kit> {
    return this.db.withTenant(async (client) => {
      const kit = await this.loadKit(user.orgId, id, client);
      if (kit.status === status) return kit;
      const outcome = await this.kits.update(user.orgId, id, { status }, undefined, client);
      return this.mapWriteOutcome(outcome);
    });
  }

  /**
   * FR-E2-5: validate → freeze an immutable kit_version (version = max + 1,
   * snapshot = the full current definition) → mark the kit published. The
   * kit row is locked for the duration so concurrent publishes serialize on
   * the (kit_id, version) unique constraint instead of racing.
   */
  async publish(user: AppUser, id: string): Promise<KitVersionSummary> {
    return this.db.withTenant(async (client) => {
      const kit = await this.kits.lockById(user.orgId, id, client);
      if (!kit) {
        throw new ApiException(404, 'KIT_NOT_FOUND', 'kit not found');
      }
      this.assertEditable(kit);
      const questions = await this.questions.listByKit(kit.id, client);
      const estimate = estimateDuration(questions);
      const errors = validateKitForPublish(kit, questions, estimate.estimatedSeconds);
      if (errors.length > 0) {
        throw new ApiException(422, 'PUBLISH_VALIDATION_FAILED', 'kit cannot be published', {
          details: errors,
        });
      }
      const version = (await this.kits.maxVersion(kit.id, client)) + 1;
      const snapshot: KitSnapshot = {
        schemaVersion: 1,
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
      const row = await this.kits.insertVersion(
        { kitId: kit.id, version, snapshot, publishedBy: user.id },
        client,
      );
      await this.kits.update(user.orgId, kit.id, { status: 'published' }, undefined, client);
      return row;
    });
  }

  async listVersions(user: AppUser, id: string): Promise<KitVersionSummary[]> {
    return this.db.withTenant(async (client) => {
      await this.loadKit(user.orgId, id, client);
      return this.kits.listVersions(id, client);
    });
  }

  async getVersion(user: AppUser, id: string, versionParam: string): Promise<KitVersion> {
    const version = Number.parseInt(versionParam, 10);
    return this.db.withTenant(async (client) => {
      await this.loadKit(user.orgId, id, client);
      if (!Number.isInteger(version) || version < 1) {
        throw new ApiException(404, 'VERSION_NOT_FOUND', 'kit version not found');
      }
      const row = await this.kits.findVersion(id, version, client);
      if (!row) {
        throw new ApiException(404, 'VERSION_NOT_FOUND', 'kit version not found');
      }
      return row;
    });
  }

  async durationEstimate(user: AppUser, id: string): Promise<DurationEstimateResponse> {
    return this.db.withTenant(async (client) => {
      const kit = await this.loadKit(user.orgId, id, client);
      const questions = await this.questions.listByKit(kit.id, client);
      const estimate = estimateDuration(questions);
      return {
        kitId: kit.id,
        questionCount: estimate.questionCount,
        baseSeconds: estimate.baseSeconds,
        estimatedSeconds: estimate.estimatedSeconds,
        capSeconds: kit.settings.totalTimeCapSec,
        withinCap: estimate.estimatedSeconds <= kit.settings.totalTimeCapSec,
        perQuestion: estimate.perQuestion,
      };
    });
  }

  /* ---- preview-as-candidate (FR-E2-6) ---- */

  async createPreviewToken(user: AppUser, id: string): Promise<PreviewTokenResponse> {
    await this.db.withTenant((client) => this.loadKit(user.orgId, id, client));
    const { token, expiresAt } = signPreviewToken(id, user.orgId, previewTokenSecret());
    return { token, expiresAt, expiresInSeconds: PREVIEW_TOKEN_TTL_SECONDS };
  }

  /**
   * Read-only draft projection. Employer-internal: the caller's session org
   * must match the org the token was minted for. Creates no session or
   * persistence rows — preview is a projection, never a write.
   */
  async resolvePreview(user: AppUser, token: string): Promise<PreviewResponse> {
    const verification = verifyPreviewToken(token ?? '', previewTokenSecret());
    if (!verification.ok) {
      if (verification.reason === 'expired') {
        throw new ApiException(
          410,
          'PREVIEW_TOKEN_EXPIRED',
          'preview link has expired — mint a new one',
        );
      }
      throw new ApiException(404, 'PREVIEW_TOKEN_INVALID', 'preview link is invalid');
    }
    if (verification.payload.orgId !== user.orgId) {
      // Cross-org tokens are indistinguishable from invalid ones.
      throw new ApiException(404, 'PREVIEW_TOKEN_INVALID', 'preview link is invalid');
    }
    return this.db.withTenant(async (client) => {
      const kit = await this.loadKit(user.orgId, verification.payload.kitId, client);
      const questions = await this.questions.listByKit(kit.id, client);
      const estimate = estimateDuration(questions);
      return {
        preview: true,
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
    });
  }
}
