import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ReportShareLink } from '@zios/shared-types';
import { DatabaseService } from '@/modules/database';
import { ApiException } from '@/common/errors';
import { ShareLinkRepository } from './share-link.repository';
import { EvaluationRepository } from './evaluation.repository';

const DEFAULT_SHARE_TTL_HOURS = 168; // 7 days
const TOKEN_BYTES = 16; // 128-bit raw token

@Injectable()
export class ShareLinkService {
  constructor(
    private readonly db: DatabaseService,
    private readonly shareLinks: ShareLinkRepository,
    private readonly reports: EvaluationRepository,
  ) {}

  /**
   * Creates a cryptographically-random share token and stores its SHA-256 hash.
   * The raw token is returned once; the database only keeps the hash.
   */
  async create(
    orgId: string,
    reportId: string,
    expiresInHours: number = DEFAULT_SHARE_TTL_HOURS,
  ): Promise<{ link: ReportShareLink; token: string }> {
    if (!(await this.reports.belongsToOrg(reportId, orgId))) {
      throw new ApiException(404, 'REPORT_NOT_FOUND', 'report not found');
    }

    const raw = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const link = await this.db.transaction(async (q) => {
      return this.shareLinks.insert({ reportId, tokenHash, expiresAt }, q);
    });

    return { link, token: raw };
  }

  /**
   * Resolves a raw share token to its report id and increments the access counter.
   * Throws 404/410 ApiException for missing or expired links.
   */
  async resolve(rawToken: string): Promise<{ link: ReportShareLink; reportId: string }> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const link = await this.shareLinks.findByTokenHash(tokenHash);
    if (!link) {
      throw new ApiException(404, 'SHARE_LINK_NOT_FOUND', 'share link not found');
    }
    if (new Date() > new Date(link.expiresAt)) {
      throw new ApiException(410, 'SHARE_LINK_EXPIRED', 'share link has expired');
    }

    await this.db.transaction(async (q) => {
      await this.shareLinks.incrementAccess(link.id, q);
    });

    return { link, reportId: link.reportId };
  }
}
