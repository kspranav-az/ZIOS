import { Injectable } from '@nestjs/common';
import type { ScoreOverride } from '@zios/shared-types';
import { DatabaseService } from '@/modules/database';
import { ApiException } from '@/common/errors';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationScoreRepository } from './score.repository';
import { OverrideRepository } from './override.repository';

const VALID_REASON_CODES = [
  'disagree_with_evidence',
  'candidate_clarified',
  'rubric_misapplied',
  'technical_misunderstanding',
  'other',
];

@Injectable()
export class OverrideService {
  constructor(
    private readonly db: DatabaseService,
    private readonly reports: EvaluationRepository,
    private readonly scores: EvaluationScoreRepository,
    private readonly overrides: OverrideRepository,
  ) {}

  async override(
    orgId: string,
    reportId: string,
    scoreId: string,
    newScore: number,
    reasonCode: string,
    reasonText?: string,
    createdBy?: string,
  ): Promise<ScoreOverride> {
    if (newScore < 1 || newScore > 5) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'score must be between 1 and 5');
    }
    if (!VALID_REASON_CODES.includes(reasonCode)) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        `reason_code must be one of: ${VALID_REASON_CODES.join(', ')}`,
      );
    }
    if (!(await this.reports.belongsToOrg(reportId, orgId))) {
      throw new ApiException(404, 'REPORT_NOT_FOUND', 'report not found');
    }

    return this.db.transaction(async (q) => {
      const score = await this.scores.findById(scoreId, q);
      if (!score || score.reportId !== reportId) {
        throw new ApiException(404, 'SCORE_NOT_FOUND', 'score not found');
      }

      const override = await this.overrides.insert(
        {
          reportId,
          scoreId,
          originalScore: score.score,
          newScore,
          reasonCode,
          reasonText,
          createdBy: createdBy ?? null,
        },
        q,
      );

      await this.scores.updateScore(scoreId, newScore, q);
      return override;
    });
  }
}
