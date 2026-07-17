import { Injectable } from '@nestjs/common';
import type {
  AppUser,
  CandidateIdUpload,
  CreateDispositionBody,
  IdUploadResponse,
  IntegrityEventBody,
  IntegrityFlag,
  IntegrityFlagsResponse,
  InterviewSession,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { DatabaseService } from '@/modules/database';
import { StorageClient } from '@/modules/storage';
import { IntegrityRepository } from './integrity.repository';

@Injectable()
export class IntegrityService {
  private readonly storage: StorageClient;

  constructor(
    private readonly db: DatabaseService,
    private readonly integrity: IntegrityRepository,
  ) {
    this.storage = new StorageClient();
  }

  async recordEvents(
    session: InterviewSession,
    _user: AppUser | null,
    body: IntegrityEventBody,
  ): Promise<IntegrityFlag[]> {
    return this.db.transaction(async (q) => {
      const created: IntegrityFlag[] = [];
      for (const event of body.events) {
        const flag = await this.integrity.insertFlag(
          {
            sessionId: session.id,
            signal: event.signal,
            occurredAt: new Date(event.occurredAt),
            evidence: event.evidence,
          },
          q,
        );
        created.push(flag);
      }
      return created;
    });
  }

  async listFlags(sessionId: string): Promise<IntegrityFlagsResponse> {
    const flags = await this.integrity.listFlagsBySession(sessionId);
    return { flags };
  }

  async dispositionFlag(
    sessionId: string,
    flagId: string,
    user: AppUser,
    body: CreateDispositionBody,
  ): Promise<IntegrityFlag> {
    return this.db.transaction(async (q) => {
      const flags = await this.integrity.listFlagsBySession(sessionId, q);
      const flag = flags.find((f) => f.id === flagId);
      if (!flag) {
        throw new ApiException(404, 'FLAG_NOT_FOUND', 'integrity flag not found');
      }
      const updated = await this.integrity.updateDisposition(
        flagId,
        {
          disposition: body.disposition,
          reasonCode: body.reasonCode,
          reasonText: body.reasonText,
          dispositionedBy: user.id,
        },
        q,
      );
      if (!updated) {
        throw new ApiException(404, 'FLAG_NOT_FOUND', 'integrity flag not found');
      }
      return updated;
    });
  }

  async uploadIdImage(
    session: InterviewSession,
    candidateId: string,
    imageBase64: string,
  ): Promise<IdUploadResponse> {
    return this.db.transaction(async (q) => {
      const uri = await this.storage.uploadEncrypted(
        `id-uploads/${session.id}`,
        Buffer.from(imageBase64, 'base64'),
      );
      const upload = await this.integrity.insertIdUpload(
        {
          candidateId,
          sessionId: session.id,
          encryptedUri: uri,
          checksumAlgorithm: 'sha256',
          checksumValue: this.storage.sha256(Buffer.from(imageBase64, 'base64')),
        },
        q,
      );
      return { upload };
    });
  }

  async listIdUploads(sessionId: string): Promise<CandidateIdUpload[]> {
    return this.integrity.listIdUploadsBySession(sessionId);
  }

  async eraseIdUpload(sessionId: string, uploadId: string): Promise<void> {
    const ok = await this.db.transaction(async (q) => {
      const uploads = await this.integrity.listIdUploadsBySession(sessionId, q);
      if (!uploads.some((u) => u.id === uploadId)) {
        return false;
      }
      return this.integrity.softDeleteIdUpload(uploadId, q);
    });
    if (!ok) {
      throw new ApiException(404, 'UPLOAD_NOT_FOUND', 'ID upload not found');
    }
  }
}
