import { Injectable } from '@nestjs/common';
import type { ConsentRecord, CreateConsentBody } from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import type { Queryable } from '@/modules/database';
import { ConsentRepository } from './consent.repository';

const DEFAULT_NOTICE_VERSION = process.env.CANDIDATE_CONSENT_NOTICE_VERSION ?? '2026.07.17-phase03';
const DEFAULT_PURPOSE = 'interview-capture';

@Injectable()
export class ConsentService {
  constructor(private readonly repository: ConsentRepository) {}

  noticeVersion(): string {
    return DEFAULT_NOTICE_VERSION;
  }

  noticeText(): string {
    return (
      process.env.CANDIDATE_CONSENT_NOTICE_TEXT ??
      [
        'This interview is conducted by an AI system.',
        'Your responses may be recorded (audio, video, or text) for evaluation.',
        'We measure observable delivery behaviour (pace, fillers, structure) — never emotion, personality, or face inference.',
        'Your data is retained according to our retention policy and you may withdraw consent at any time.',
        'Purpose: interview evaluation for the role you applied to.',
      ].join(' ')
    );
  }

  async create(body: CreateConsentBody, q: Queryable): Promise<ConsentRecord> {
    const subjectId = body?.subjectId?.trim();
    if (!subjectId) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'subjectId is required');
    }
    const artifactUri = body?.artifactUri?.trim() ?? `artifact://consent/${crypto.randomUUID()}`;
    return this.repository.insert(
      {
        sessionId: body?.sessionId,
        inviteId: body?.inviteId,
        subjectId,
        purpose: body?.purpose?.trim() || DEFAULT_PURPOSE,
        noticeVersion: body?.noticeVersion?.trim() || this.noticeVersion(),
        noticeText: body?.noticeText?.trim() || this.noticeText(),
        artifactUri,
      },
      q,
    );
  }

  async createForInvite(
    input: { inviteId: string; subjectId: string; noticeText?: string; artifactUri?: string },
    q: Queryable,
  ): Promise<ConsentRecord> {
    return this.repository.insert(
      {
        inviteId: input.inviteId,
        subjectId: input.subjectId,
        purpose: DEFAULT_PURPOSE,
        noticeVersion: this.noticeVersion(),
        noticeText: input.noticeText?.trim() || this.noticeText(),
        artifactUri: input.artifactUri ?? `artifact://consent/${crypto.randomUUID()}`,
      },
      q,
    );
  }

  async get(id: string): Promise<ConsentRecord> {
    const consent = await this.repository.findById(id);
    if (!consent) {
      throw new ApiException(404, 'CONSENT_NOT_FOUND', 'consent record not found');
    }
    return consent;
  }

  async findBySessionId(sessionId: string, q?: Queryable): Promise<ConsentRecord | null> {
    return this.repository.findBySessionId(sessionId, q);
  }

  async findByInviteId(inviteId: string, q?: Queryable): Promise<ConsentRecord | null> {
    return this.repository.findByInviteId(inviteId, q);
  }
}
