import { Injectable } from '@nestjs/common';
import type { BankSearchResponse, QuestionDifficulty, QuestionType } from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { QUESTION_DIFFICULTIES, QUESTION_TYPES } from '@/common/question-taxonomy';
import { BANK_PAGE_SIZE, QuestionBankRepository } from './question-bank.repository';

export interface BankSearchParams {
  query?: string;
  role_family?: string;
  topic?: string;
  type?: string;
  difficulty?: string;
  tag?: string;
  page?: string;
}

/** FR-E4-1: bank search inside the kit builder (ILIKE + filters, 50/page). */
@Injectable()
export class QuestionBankService {
  constructor(private readonly bank: QuestionBankRepository) {}

  async search(params: BankSearchParams): Promise<BankSearchResponse> {
    let page = 1;
    if (params.page !== undefined && params.page !== '') {
      page = Number.parseInt(params.page, 10);
      if (!Number.isInteger(page) || page < 1) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'page must be a positive integer');
      }
    }
    if (params.type !== undefined && params.type !== '') {
      if (!QUESTION_TYPES.includes(params.type as QuestionType)) {
        throw new ApiException(
          400,
          'VALIDATION_ERROR',
          `type must be one of ${QUESTION_TYPES.join(', ')}`,
        );
      }
    }
    if (params.difficulty !== undefined && params.difficulty !== '') {
      if (!QUESTION_DIFFICULTIES.includes(params.difficulty as QuestionDifficulty)) {
        throw new ApiException(
          400,
          'VALIDATION_ERROR',
          `difficulty must be one of ${QUESTION_DIFFICULTIES.join(', ')}`,
        );
      }
    }

    const query = params.query?.trim() || undefined;
    const { items, total } = await this.bank.search({
      query,
      roleFamily: params.role_family?.trim() || undefined,
      topic: params.topic?.trim() || undefined,
      type: params.type ? (params.type as QuestionType) : undefined,
      difficulty: params.difficulty ? (params.difficulty as QuestionDifficulty) : undefined,
      tag: params.tag?.trim() || undefined,
      page,
    });
    return {
      items,
      page,
      pageSize: BANK_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / BANK_PAGE_SIZE),
    };
  }
}
