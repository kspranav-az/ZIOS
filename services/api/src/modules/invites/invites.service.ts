import { Injectable } from '@nestjs/common';
import type {
  BulkInviteResponse,
  BulkInviteRowResult,
  Candidate,
  CreateCandidateInviteBody,
  CreateCandidateInviteResponse,
  Invite,
  InviteDetailResponse,
  ReissueInviteBody,
  RescheduleInviteBody,
  TokenResolveResponse,
} from '@zios/shared-types';
import { TokenService } from '@/common/tokens';
import { CandidatesRepository } from '@/modules/candidates';
import { ApiException, assertValidEmail } from '@/common/errors';
import { DatabaseService, type Queryable } from '@/modules/database';
import { KitVersionsRepository } from '@/modules/kits';
import { CsvParserService, type ParsedCsvRow } from './csv-parser.service';
import { InvitesRepository } from './invites.repository';

const DEFAULT_INVITE_TTL_DAYS = 7;
const MAX_BULK_ROWS = 10_000;

@Injectable()
export class InvitesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly candidates: CandidatesRepository,
    private readonly invites: InvitesRepository,
    private readonly kitVersions: KitVersionsRepository,
    private readonly csvParser: CsvParserService,
  ) {}

  private defaultExpiry(): Date {
    return new Date(Date.now() + DEFAULT_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private expiryFromDays(days: number | undefined): Date {
    const d =
      Number.isInteger(days) && (days as number) > 0 ? (days as number) : DEFAULT_INVITE_TTL_DAYS;
    return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
  }

  private async loadVersionForWrite(
    orgId: string,
    kitVersionId: string,
    q: Queryable,
  ): Promise<NonNullable<Awaited<ReturnType<KitVersionsRepository['findById']>>>> {
    const version = await this.kitVersions.findById(kitVersionId, q);
    if (!version) {
      throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
    }
    if (version.org_id !== orgId) {
      // Cross-org IDs are indistinguishable from missing.
      throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
    }
    return version;
  }

  async create(
    orgId: string,
    body: CreateCandidateInviteBody,
  ): Promise<CreateCandidateInviteResponse> {
    const kitVersionId = body?.kitVersionId;
    if (!kitVersionId || typeof kitVersionId !== 'string') {
      throw new ApiException(400, 'VALIDATION_ERROR', 'kitVersionId is required');
    }
    const candidateInput = body?.candidate;
    if (!candidateInput || typeof candidateInput !== 'object') {
      throw new ApiException(400, 'VALIDATION_ERROR', 'candidate is required');
    }
    const name = typeof candidateInput.name === 'string' ? candidateInput.name.trim() : '';
    const email =
      typeof candidateInput.email === 'string' ? candidateInput.email.trim().toLowerCase() : '';
    assertValidEmail(email);
    if (!name) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'candidate name is required');
    }
    const phone =
      typeof candidateInput.phone === 'string' ? candidateInput.phone.trim() : undefined;
    const externalRef =
      typeof candidateInput.externalRef === 'string'
        ? candidateInput.externalRef.trim()
        : undefined;

    return this.db.transaction(async (q) => {
      await this.loadVersionForWrite(orgId, kitVersionId, q);
      const candidate = await this.candidates.insert({ orgId, name, email, phone, externalRef }, q);
      const rawToken = TokenService.generateRaw();
      const invite = await this.invites.insert(
        {
          orgId,
          kitVersionId,
          candidateId: candidate.id,
          tokenHash: TokenService.hash(rawToken),
          expiresAt: this.expiryFromDays(body?.expiresInDays),
          otpRequired: body?.otpRequired === true,
          metadata: body?.metadata,
        },
        q,
      );
      return { invite, candidate, token: rawToken };
    });
  }

  async bulkCreate(orgId: string, buffer: Buffer): Promise<BulkInviteResponse> {
    const parsed = await this.csvParser.parse(buffer);
    if (parsed.length > MAX_BULK_ROWS) {
      throw new ApiException(400, 'VALIDATION_ERROR', `CSV cannot exceed ${MAX_BULK_ROWS} rows`);
    }

    // We need a kit version to bind every row to. The CSV is just candidates;
    // the employer sends the kitVersionId as a query/body param. For now we
    // require it via a simple header/query fallback is left to the controller.
    // This service signature will be updated when the controller is written.
    throw new ApiException(501, 'NOT_IMPLEMENTED', 'bulk create controller wiring pending');
  }

  async bulkCreateWithKitVersionId(
    orgId: string,
    kitVersionId: string,
    buffer: Buffer,
  ): Promise<BulkInviteResponse> {
    const parsed = await this.csvParser.parse(buffer);
    if (parsed.length > MAX_BULK_ROWS) {
      throw new ApiException(400, 'VALIDATION_ERROR', `CSV cannot exceed ${MAX_BULK_ROWS} rows`);
    }

    const results: BulkInviteRowResult[] = [];
    let successes = 0;
    let errors = 0;

    await this.db.transaction(async (q) => {
      await this.loadVersionForWrite(orgId, kitVersionId, q);
      for (const row of parsed) {
        const rowResult = await this.processBulkRow(orgId, kitVersionId, row, q);
        results.push(rowResult);
        if (rowResult.error) {
          errors += 1;
        } else {
          successes += 1;
        }
      }
    });

    return { total: parsed.length, successes, errors, results };
  }

  private async processBulkRow(
    orgId: string,
    kitVersionId: string,
    row: ParsedCsvRow,
    q: Queryable,
  ): Promise<BulkInviteRowResult> {
    if (row.errors.length > 0) {
      return { row: row.row, error: row.errors.join('; ') };
    }
    const { name, email, phone, externalRef } = row.data;
    try {
      const candidate = await this.candidates.insert(
        { orgId, name: name as string, email: (email as string).toLowerCase(), phone, externalRef },
        q,
      );
      const rawToken = TokenService.generateRaw();
      const invite = await this.invites.insert(
        {
          orgId,
          kitVersionId,
          candidateId: candidate.id,
          tokenHash: TokenService.hash(rawToken),
          expiresAt: this.defaultExpiry(),
          otpRequired: false,
        },
        q,
      );
      return { row: row.row, invite, candidate, token: rawToken };
    } catch (error) {
      const message = error instanceof ApiException ? error.message : 'failed to create invite';
      return { row: row.row, error: message };
    }
  }

  async list(orgId: string): Promise<Invite[]> {
    return this.db.withTenant((q) => this.invites.listByOrg(orgId, q));
  }

  async getDetail(orgId: string, id: string): Promise<InviteDetailResponse> {
    return this.db.withTenant(async (q) => {
      const invite = await this.invites.findById(orgId, id, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      const candidate = await this.candidates.findById(orgId, invite.candidateId, q);
      if (!candidate) {
        throw new ApiException(404, 'CANDIDATE_NOT_FOUND', 'candidate not found');
      }
      const version = await this.kitVersions.findById(invite.kitVersionId, q);
      if (!version) {
        throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
      }
      return {
        invite,
        candidate,
        kitVersion: this.kitVersions.mapSummary(version),
      };
    });
  }

  async reissue(
    orgId: string,
    id: string,
    body: ReissueInviteBody,
  ): Promise<{ invite: Invite; candidate: Candidate; token: string }> {
    return this.db.withTenant(async (q) => {
      const invite = await this.invites.findById(orgId, id, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      if (invite.status === 'completed') {
        throw new ApiException(409, 'INVITE_COMPLETED', 'cannot reissue a completed invite');
      }
      const candidate = await this.candidates.findById(orgId, invite.candidateId, q);
      if (!candidate) {
        throw new ApiException(404, 'CANDIDATE_NOT_FOUND', 'candidate not found');
      }
      const rawToken = TokenService.generateRaw();
      const updated = await this.invites.update(
        orgId,
        id,
        {
          tokenHash: TokenService.hash(rawToken),
          expiresAt: body?.expiresInDays
            ? this.expiryFromDays(body.expiresInDays)
            : new Date(invite.expiresAt),
        },
        q,
      );
      if (!updated) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      return { invite: updated, candidate, token: rawToken };
    });
  }

  async reschedule(orgId: string, id: string, body: RescheduleInviteBody): Promise<Invite> {
    return this.db.withTenant(async (q) => {
      const invite = await this.invites.findById(orgId, id, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      if (invite.status === 'completed') {
        throw new ApiException(409, 'INVITE_COMPLETED', 'cannot reschedule a completed invite');
      }
      let expiresAt: Date;
      if (body?.expiresAt) {
        expiresAt = new Date(body.expiresAt);
        if (Number.isNaN(expiresAt.getTime())) {
          throw new ApiException(400, 'VALIDATION_ERROR', 'expiresAt is not a valid date');
        }
      } else if (body?.extendDays !== undefined) {
        const days = Number(body.extendDays);
        if (!Number.isInteger(days) || days <= 0) {
          throw new ApiException(400, 'VALIDATION_ERROR', 'extendDays must be a positive integer');
        }
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      } else {
        throw new ApiException(400, 'VALIDATION_ERROR', 'expiresAt or extendDays is required');
      }
      const updated = await this.invites.update(orgId, id, { expiresAt }, q);
      if (!updated) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      return updated;
    });
  }

  async markOtpVerified(inviteId: string, q: Queryable): Promise<Invite> {
    const orgIds = await q.query('SELECT org_id FROM invite WHERE id = $1', [inviteId]);
    const orgId = (orgIds.rows[0] as { org_id: string } | undefined)?.org_id;
    if (!orgId) {
      throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
    }
    const updated = await this.invites.update(orgId, inviteId, { otpVerifiedAt: new Date() }, q);
    if (!updated) {
      throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
    }
    return updated;
  }

  /** Public token resolution (no tenant context — org is derived from token). */
  async resolveByToken(rawToken: string): Promise<TokenResolveResponse> {
    const tokenHash = TokenService.hash(rawToken);
    return this.db.transaction(async (q) => {
      const invite = await this.invites.findByTokenHash(tokenHash, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      const candidate = await this.candidates.findById(invite.orgId, invite.candidateId, q);
      if (!candidate) {
        throw new ApiException(404, 'CANDIDATE_NOT_FOUND', 'candidate not found');
      }
      const version = await this.kitVersions.findById(invite.kitVersionId, q);
      if (!version) {
        throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
      }
      // Session loading is delegated to the sessions module; this method returns
      // only the invite/candidate/kit preview so the controller can layer
      // session state on top.
      return {
        invite,
        candidate,
        kit: version.snapshot.kit,
        questions: version.snapshot.questions,
        otpRequired: invite.otpRequired,
        otpVerified: invite.otpVerifiedAt !== null,
        session: null,
        consent: null,
      };
    });
  }
}
