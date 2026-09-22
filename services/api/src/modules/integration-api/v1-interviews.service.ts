import { Injectable } from '@nestjs/common';
import type { AppUser, KitSettings } from '@zios/shared-types';
import { ApiException, assertValidEmail } from '@/common/errors';
import { DatabaseService } from '@/modules/database';
import { EvaluationService } from '@/modules/evaluation';
import { GenerationService } from '@/modules/generation';
import { KitVersionsRepository, KitsService } from '@/modules/kits';
import { InvitesRepository, InvitesService } from '@/modules/invites';
import { SessionsRepository } from '@/modules/sessions';
import { ExternalInterviewRepository } from './external-interview.repository';
import type { ApiKeyAuth } from './api-key-auth.guard';

export type V1InterviewMode = 'text' | 'voice' | 'video' | 'human';

const SUPPORTED_MODES: V1InterviewMode[] = ['text', 'voice', 'video', 'human'];
const DEFAULT_V1_INVITE_TTL_DAYS = 30;

export interface V1CreateInterviewBody {
  kit_id?: string;
  jd_text?: string;
  candidate?: {
    name?: string;
    email?: string;
    phone?: string;
    external_ref?: string;
  };
  mode?: string;
  proctoring_level?: string;
  send_invite?: boolean;
}

export interface V1InterviewCreated {
  interview_id: string;
  /** Absolute candidate-web link with the invite token; null on idempotent replay. */
  invite_link: string | null;
  status: 'invited';
  idempotent_replay: boolean;
}

export interface V1InterviewStatus {
  id: string;
  status: string;
  mode: string;
  candidate: { external_ref: string };
  created_at: string;
  completed_at: string | null;
}

export interface V1Scorecard {
  schema_version: 'v1';
  interview_id: string;
  candidate: { external_ref: string };
  report: unknown;
  scores: unknown[];
  evidence_spans: unknown[];
  overrides: unknown[];
  recommendation: string | null;
}

function candidateBaseUrl(): string {
  return process.env.PUBLIC_CANDIDATE_BASE_URL ?? 'http://localhost:5174';
}

/** Kit sessions run in text/voice/video; 'human' is a conductor, backed by a
 *  video-mode kit (LiveKit room). */
function kitModeFor(mode: V1InterviewMode): 'text' | 'voice' | 'video' {
  return mode === 'human' ? 'video' : mode;
}

/**
 * Partner-facing interview lifecycle (FR-E13-2/3): one call creates an
 * interview (kit or raw JD text), retries are idempotent per
 * (org, external_ref, kit_version), status is pollable, and the finished
 * scorecard reuses the exact evaluation read path the web report uses.
 */
@Injectable()
export class V1InterviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly externalInterviews: ExternalInterviewRepository,
    private readonly invites: InvitesService,
    private readonly invitesRepo: InvitesRepository,
    private readonly kits: KitsService,
    private readonly kitVersions: KitVersionsRepository,
    private readonly generation: GenerationService,
    private readonly evaluation: EvaluationService,
    private readonly sessions: SessionsRepository,
  ) {}

  async create(auth: ApiKeyAuth, body: V1CreateInterviewBody): Promise<V1InterviewCreated> {
    const input = this.validateBody(body);
    const orgUser = await this.firstOrgUser(auth.orgId);

    // 1. Resolve the kit version to bind the interview to.
    let kitVersionId: string;
    if (input.kitId) {
      kitVersionId = await this.resolveKitVersion(auth.orgId, orgUser, input.kitId, input.mode);
    } else {
      kitVersionId = await this.generateKitVersion(orgUser, input.jdText, input.mode, input.proctoringLevel);
    }

    // 2. Create the candidate + invite (mirrors the employer invite flow;
    //    the session is created on first candidate open, as usual).
    const { invite, token } = await this.invites.create(auth.orgId, {
      kitVersionId,
      candidate: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        externalRef: input.externalRef,
      },
      conductor: input.mode === 'human' ? 'human' : 'ai',
      expiresInDays: DEFAULT_V1_INVITE_TTL_DAYS,
      metadata: {
        source: 'api_v1',
        mode: input.mode,
        proctoringLevel: input.proctoringLevel ?? 'none',
      },
    });

    // 3. Idempotency anchor. A retry with the same (org, external_ref, kit
    //    version) resolves to the FIRST interview; the invite created above
    //    loses the race and stays unreachable (never returned, expires).
    const row = await this.externalInterviews.insertIdempotent({
      orgId: auth.orgId,
      externalRef: input.externalRef,
      kitVersionId,
      inviteId: invite.id,
    });
    if (!row) {
      const existing = await this.externalInterviews.findByExternalRef(
        auth.orgId,
        input.externalRef,
        kitVersionId,
      );
      if (!existing) {
        throw new ApiException(500, 'INTERNAL_ERROR', 'idempotency conflict without a winner row');
      }
      return { interview_id: existing.id, invite_link: null, status: 'invited', idempotent_replay: true };
    }

    return {
      interview_id: row.id,
      invite_link: `${candidateBaseUrl()}/?token=${encodeURIComponent(token)}`,
      status: 'invited',
      idempotent_replay: false,
    };
  }

  async getStatus(auth: ApiKeyAuth, interviewId: string): Promise<V1InterviewStatus> {
    const resolved = await this.resolveInterview(auth.orgId, interviewId);
    const session = await this.sessions.findByInviteId(resolved.external.inviteId);
    return {
      id: resolved.external.id,
      status: session?.status ?? resolved.invite.status,
      mode:
        ((resolved.invite.metadata as Record<string, unknown> | undefined)?.['mode'] as
          | string
          | undefined) ??
        session?.mode ??
        'text',
      candidate: { external_ref: resolved.candidateExternalRef },
      created_at: resolved.external.createdAt,
      completed_at: session?.endedAt ?? null,
    };
  }

  async getScorecard(auth: ApiKeyAuth, interviewId: string): Promise<V1Scorecard> {
    const resolved = await this.resolveInterview(auth.orgId, interviewId);
    const session = await this.sessions.findByInviteId(resolved.external.inviteId);
    if (!session) {
      throw new ApiException(404, 'REPORT_NOT_FOUND', 'interview has not started yet');
    }
    const detail = await this.evaluation.findDetail(auth.orgId, session.id);
    const report = detail.report as Record<string, unknown> | null;
    return {
      schema_version: 'v1',
      interview_id: resolved.external.id,
      candidate: { external_ref: resolved.candidateExternalRef },
      report: detail.report,
      scores: detail.scores,
      evidence_spans: detail.evidenceSpans,
      overrides: detail.overrides,
      recommendation: (report?.['recommendation'] as string | undefined) ?? null,
    };
  }

  /* ---- internals ---- */

  private validateBody(body: V1CreateInterviewBody): {
    kitId: string | null;
    jdText: string;
    mode: V1InterviewMode;
    proctoringLevel: string | null;
    name: string;
    email: string;
    phone: string | undefined;
    externalRef: string;
  } {
    const kitId = typeof body?.kit_id === 'string' && body.kit_id.trim() ? body.kit_id.trim() : null;
    const jdText = typeof body?.jd_text === 'string' ? body.jd_text.trim() : '';
    if ((kitId === null) === (jdText.length === 0)) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        'exactly one of kit_id or jd_text is required',
      );
    }

    const mode = body?.mode as V1InterviewMode;
    if (body?.mode === 'async_video') {
      throw new ApiException(
        422,
        'MODE_NOT_SUPPORTED',
        'async_video is not available via /v1 yet; use the async-video endpoints',
      );
    }
    if (!SUPPORTED_MODES.includes(mode)) {
      throw new ApiException(400, 'VALIDATION_ERROR', `mode must be one of: ${SUPPORTED_MODES.join(', ')}`);
    }

    const candidate = body?.candidate;
    const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
    const email = typeof candidate?.email === 'string' ? candidate.email.trim().toLowerCase() : '';
    const externalRef =
      typeof candidate?.external_ref === 'string' ? candidate.external_ref.trim() : '';
    if (!name) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'candidate.name is required');
    }
    assertValidEmail(email);
    if (!externalRef) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'candidate.external_ref is required');
    }
    const phone = typeof candidate?.phone === 'string' ? candidate.phone.trim() : undefined;
    const proctoringLevel =
      typeof body?.proctoring_level === 'string' && body.proctoring_level.trim()
        ? body.proctoring_level.trim()
        : null;

    return { kitId, jdText, mode, proctoringLevel, name, email, phone, externalRef };
  }

  /** kit_id path: org-owned kit, latest published version, mode must match.
   *  Human-facilitated interviews run in video rooms, so they require a
   *  video-mode kit. */
  private async resolveKitVersion(
    orgId: string,
    user: AppUser,
    kitId: string,
    mode: V1InterviewMode,
  ): Promise<string> {
    const requiredMode = kitModeFor(mode);
    const versions = await this.kits.listVersions(user, kitId);
    if (versions.length === 0) {
      // Covers missing kits too: listVersions throws 404 on cross-org/missing.
      throw new ApiException(422, 'KIT_NOT_PUBLISHED', 'kit has no published version');
    }
    const latest = versions[0]!;
    const versionRow = await this.kitVersions.findById(latest.id);
    const kitMode = (versionRow?.snapshot as { kit?: { settings?: KitSettings } } | undefined)?.kit
      ?.settings?.mode;
    if (kitMode && kitMode !== requiredMode) {
      throw new ApiException(
        422,
        'MODE_MISMATCH',
        `kit is configured for mode '${kitMode}' but the request asked for '${mode}'`,
      );
    }
    return latest.id;
  }

  /** jd_text path: generate + publish a kit bound to the org, with the
   *  requested mode/proctoring baked into its settings. */
  private async generateKitVersion(
    user: AppUser,
    jdText: string,
    mode: V1InterviewMode,
    proctoringLevel: string | null,
  ): Promise<string> {
    const generation = await this.generation.analyzeAndPropose(user.orgId, jdText);
    const settingsOverrides: Partial<KitSettings> = { mode: kitModeFor(mode) };
    if (proctoringLevel) {
      settingsOverrides.proctoringLevel = proctoringLevel as KitSettings['proctoringLevel'];
    }
    const published = await this.generation.publishProposal(
      user,
      generation.id,
      undefined,
      undefined,
      settingsOverrides,
    );
    return published.version.id;
  }

  private async resolveInterview(
    orgId: string,
    interviewId: string,
  ): Promise<{
    external: { id: string; inviteId: string; createdAt: string };
    invite: { status: string; candidateId: string; metadata: unknown };
    candidateExternalRef: string;
  }> {
    const external = await this.externalInterviews.findById(interviewId, orgId);
    if (!external) {
      throw new ApiException(404, 'INTERVIEW_NOT_FOUND', 'interview not found');
    }
    const invite = await this.invitesRepo.findById(orgId, external.inviteId);
    if (!invite) {
      throw new ApiException(404, 'INTERVIEW_NOT_FOUND', 'interview not found');
    }
    const result = await this.db.query(
      `SELECT external_ref FROM candidate WHERE id = $1 AND org_id = $2`,
      [invite.candidateId, orgId],
    );
    const candidateExternalRef = (result.rows[0] as { external_ref: string | null } | undefined)
      ?.external_ref;
    return { external, invite, candidateExternalRef: candidateExternalRef ?? '' };
  }

  /**
   * publishProposal and KitsService need an AppUser for org scoping and
   * audit columns. API-key calls have no app_user, so we act as the org's
   * first member (the admin who created the workspace).
   */
  private async firstOrgUser(orgId: string): Promise<AppUser> {
    const result = await this.db.query(
      `SELECT id, org_id, email, name, role, created_at
       FROM app_user WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [orgId],
    );
    const row = result.rows[0] as
      | { id: string; org_id: string; email: string; name: string; role: AppUser['role']; created_at: Date }
      | undefined;
    if (!row) {
      throw new ApiException(500, 'INTERNAL_ERROR', 'org has no users');
    }
    return {
      id: row.id,
      orgId: row.org_id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at.toISOString(),
    };
  }
}
