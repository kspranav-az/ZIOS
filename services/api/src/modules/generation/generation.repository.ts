import { Injectable } from '@nestjs/common';
import type {
  GenerationProposal,
  JdGeneration,
  JdProfile,
  JdGenerationStatus,
} from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

const TRUNC_NOW = `date_trunc('milliseconds', now())`;

interface JdGenerationRow {
  id: string;
  org_id: string;
  kit_id: string | null;
  jd_hash: string;
  prompt_version: string;
  status: string;
  role_profile: JdProfile;
  proposal: GenerationProposal;
  edits: unknown[];
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, org_id, kit_id, jd_hash, prompt_version, status, role_profile, proposal, edits, error_message, created_at, updated_at';

function mapRow(row: JdGenerationRow): JdGeneration {
  return {
    id: row.id,
    orgId: row.org_id,
    kitId: row.kit_id,
    jdHash: row.jd_hash,
    promptVersion: row.prompt_version,
    status: row.status as JdGenerationStatus,
    roleProfile: row.role_profile,
    proposal: row.proposal,
    edits: row.edits,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class GenerationRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      orgId: string;
      jdHash: string;
      promptVersion: string;
      status: JdGenerationStatus;
      roleProfile: JdProfile;
      proposal: GenerationProposal;
      edits: unknown[];
      errorMessage?: string | null;
    },
    q: Queryable = this.db,
  ): Promise<JdGeneration> {
    const result = await q.query(
      `INSERT INTO jd_generation (org_id, jd_hash, prompt_version, status, role_profile, proposal, edits, error_message, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, ${TRUNC_NOW}, ${TRUNC_NOW})
       RETURNING ${COLUMNS}`,
      [
        input.orgId,
        input.jdHash,
        input.promptVersion,
        input.status,
        input.roleProfile,
        input.proposal,
        input.edits,
        input.errorMessage ?? null,
      ],
    );
    return mapRow(result.rows[0] as JdGenerationRow);
  }

  async findById(orgId: string, id: string, q: Queryable = this.db): Promise<JdGeneration | null> {
    const result = await q.query(
      `SELECT ${COLUMNS} FROM jd_generation WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    const row = result.rows[0] as JdGenerationRow | undefined;
    return row ? mapRow(row) : null;
  }

  async update(
    orgId: string,
    id: string,
    input: {
      status?: JdGenerationStatus;
      roleProfile?: JdProfile;
      proposal?: GenerationProposal;
      edits?: unknown[];
      kitId?: string | null;
      errorMessage?: string | null;
    },
    q: Queryable = this.db,
  ): Promise<JdGeneration | null> {
    const assignments: string[] = [`updated_at = ${TRUNC_NOW}`];
    const params: unknown[] = [];
    const push = (clause: string, value: unknown): void => {
      params.push(value);
      assignments.push(`${clause} = $${params.length}`);
    };
    const pushJson = (clause: string, value: unknown): void => {
      params.push(JSON.stringify(value));
      assignments.push(`${clause} = $${params.length}::jsonb`);
    };
    if (input.status !== undefined) push('status', input.status);
    if (input.roleProfile !== undefined) pushJson('role_profile', input.roleProfile);
    if (input.proposal !== undefined) pushJson('proposal', input.proposal);
    if (input.edits !== undefined) pushJson('edits', input.edits);
    if (input.kitId !== undefined) push('kit_id', input.kitId);
    if (input.errorMessage !== undefined) push('error_message', input.errorMessage);
    params.push(id);
    const idParam = params.length;
    params.push(orgId);
    const orgParam = params.length;
    const result = await q.query(
      `UPDATE jd_generation SET ${assignments.join(', ')} WHERE id = $${idParam} AND org_id = $${orgParam} RETURNING ${COLUMNS}`,
      params,
    );
    const row = result.rows[0] as JdGenerationRow | undefined;
    return row ? mapRow(row) : null;
  }
}
