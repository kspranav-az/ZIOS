import { Injectable } from '@nestjs/common';
import type { CandidateIdUpload, IntegrityFlag } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface IntegrityFlagRow {
  id: string;
  session_id: string;
  signal: string;
  occurred_at: Date;
  evidence: Record<string, unknown>;
  disposition: string;
  disposition_reason_code: string | null;
  disposition_reason_text: string | null;
  dispositioned_by: string | null;
  dispositioned_at: Date | null;
  created_at: Date;
}

export interface CandidateIdUploadRow {
  id: string;
  candidate_id: string;
  session_id: string;
  encrypted_uri: string;
  checksum_algorithm: string;
  checksum_value: string;
  uploaded_at: Date;
  deleted_at: Date | null;
}

function mapFlag(row: IntegrityFlagRow): IntegrityFlag {
  return {
    id: row.id,
    sessionId: row.session_id,
    signal: row.signal as IntegrityFlag['signal'],
    occurredAt: row.occurred_at.toISOString(),
    evidence: row.evidence,
    disposition: row.disposition as IntegrityFlag['disposition'],
    dispositionReasonCode:
      (row.disposition_reason_code as IntegrityFlag['dispositionReasonCode']) ?? null,
    dispositionReasonText: row.disposition_reason_text,
    dispositionedBy: row.dispositioned_by,
    dispositionedAt: row.dispositioned_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapIdUpload(row: CandidateIdUploadRow): CandidateIdUpload {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    sessionId: row.session_id,
    encryptedUri: row.encrypted_uri,
    checksum: {
      algorithm: row.checksum_algorithm as CandidateIdUpload['checksum']['algorithm'],
      value: row.checksum_value,
    },
    uploadedAt: row.uploaded_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };
}

@Injectable()
export class IntegrityRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertFlag(
    input: {
      sessionId: string;
      signal: IntegrityFlag['signal'];
      occurredAt: Date;
      evidence: Record<string, unknown>;
    },
    q: Queryable,
  ): Promise<IntegrityFlag> {
    const result = await q.query(
      `INSERT INTO integrity_flag (session_id, signal, occurred_at, evidence)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [input.sessionId, input.signal, input.occurredAt, JSON.stringify(input.evidence)],
    );
    return mapFlag(result.rows[0] as IntegrityFlagRow);
  }

  async listFlagsBySession(sessionId: string, q: Queryable = this.db): Promise<IntegrityFlag[]> {
    const result = await q.query(
      'SELECT * FROM integrity_flag WHERE session_id = $1 ORDER BY occurred_at ASC',
      [sessionId],
    );
    return (result.rows as IntegrityFlagRow[]).map(mapFlag);
  }

  async updateDisposition(
    flagId: string,
    input: {
      disposition: Exclude<IntegrityFlag['disposition'], 'pending'>;
      reasonCode: IntegrityFlag['dispositionReasonCode'];
      reasonText?: string;
      dispositionedBy: string;
    },
    q: Queryable,
  ): Promise<IntegrityFlag | null> {
    const result = await q.query(
      `UPDATE integrity_flag
       SET disposition = $1,
           disposition_reason_code = $2,
           disposition_reason_text = $3,
           dispositioned_by = $4,
           dispositioned_at = now(),
           updated_at = now()
       WHERE id = $5
       RETURNING *`,
      [
        input.disposition,
        input.reasonCode,
        input.reasonText ?? null,
        input.dispositionedBy,
        flagId,
      ],
    );
    return (result.rows[0] as IntegrityFlagRow | undefined)
      ? mapFlag(result.rows[0] as IntegrityFlagRow)
      : null;
  }

  async insertIdUpload(
    input: {
      candidateId: string;
      sessionId: string;
      encryptedUri: string;
      checksumAlgorithm: string;
      checksumValue: string;
    },
    q: Queryable,
  ): Promise<CandidateIdUpload> {
    const result = await q.query(
      `INSERT INTO candidate_id_upload (candidate_id, session_id, encrypted_uri, checksum_algorithm, checksum_value)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.candidateId,
        input.sessionId,
        input.encryptedUri,
        input.checksumAlgorithm,
        input.checksumValue,
      ],
    );
    return mapIdUpload(result.rows[0] as CandidateIdUploadRow);
  }

  async listIdUploadsBySession(
    sessionId: string,
    q: Queryable = this.db,
  ): Promise<CandidateIdUpload[]> {
    const result = await q.query(
      'SELECT * FROM candidate_id_upload WHERE session_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at DESC',
      [sessionId],
    );
    return (result.rows as CandidateIdUploadRow[]).map(mapIdUpload);
  }

  async softDeleteIdUpload(uploadId: string, q: Queryable): Promise<boolean> {
    const result = await q.query(
      'UPDATE candidate_id_upload SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [uploadId],
    );
    return (result.rows as { id: string }[]).length > 0;
  }
}
