import { Injectable } from '@nestjs/common';
import type {
  Kit,
  KitSettings,
  KitSnapshot,
  KitStatus,
  KitVersion,
  KitVersionSummary,
} from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

/**
 * Millisecond-truncated timestamps on every write: the optimistic-concurrency
 * guard compares updated_at against an ISO string that round-tripped through
 * a JS Date (millisecond precision), so stored values must be ms-exact.
 */
const TRUNC_NOW = `date_trunc('milliseconds', now())`;

export interface KitRow {
  id: string;
  org_id: string;
  title: string;
  role: string | null;
  level: string | null;
  status: string;
  settings: Record<string, unknown>;
  jd_ref: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface KitVersionRow {
  id: string;
  kit_id: string;
  version: number;
  snapshot: KitSnapshot;
  published_by: string;
  published_at: Date;
}

/** Outcome of a guarded write; lets services map missing → 404, stale → 409. */
export type WriteOutcome<T> =
  { kind: 'ok'; value: T } | { kind: 'stale'; current: T } | { kind: 'missing' };

export function mapSettingsRow(raw: Record<string, unknown>): KitSettings {
  return {
    mode: raw.mode as KitSettings['mode'],
    language: raw.language as string,
    proctoringLevel: raw.proctoring_level as KitSettings['proctoringLevel'],
    introText: (raw.intro_text as string | null) ?? null,
    outroText: (raw.outro_text as string | null) ?? null,
    logoUrl: (raw.logo_url as string | null) ?? null,
    totalTimeCapSec: raw.total_time_cap_sec as number,
  };
}

export function settingsToDbJson(settings: KitSettings): string {
  return JSON.stringify({
    mode: settings.mode,
    language: settings.language,
    proctoring_level: settings.proctoringLevel,
    intro_text: settings.introText,
    outro_text: settings.outroText,
    logo_url: settings.logoUrl,
    total_time_cap_sec: settings.totalTimeCapSec,
  });
}

export function mapKitRow(row: KitRow): Kit {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    role: row.role,
    level: row.level,
    status: row.status as KitStatus,
    settings: mapSettingsRow(row.settings),
    jdRef: row.jd_ref,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapVersionSummaryRow(row: KitVersionRow): KitVersionSummary {
  return {
    id: row.id,
    kitId: row.kit_id,
    version: row.version,
    publishedBy: row.published_by,
    publishedAt: row.published_at.toISOString(),
  };
}

const KIT_COLUMNS =
  'id, org_id, title, role, level, status, settings, jd_ref, created_by, created_at, updated_at';
const VERSION_COLUMNS = 'id, kit_id, version, snapshot, published_by, published_at';

export interface KitUpdateFields {
  title?: string;
  role?: string | null;
  level?: string | null;
  status?: KitStatus;
  settings?: KitSettings;
}

@Injectable()
export class KitsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      orgId: string;
      title: string;
      role: string | null;
      level: string | null;
      settings: KitSettings;
      createdBy: string;
    },
    q: Queryable,
  ): Promise<Kit> {
    const result = await q.query(
      `INSERT INTO kit (org_id, title, role, level, settings, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, ${TRUNC_NOW}, ${TRUNC_NOW})
       RETURNING ${KIT_COLUMNS}`,
      [
        input.orgId,
        input.title,
        input.role,
        input.level,
        settingsToDbJson(input.settings),
        input.createdBy,
      ],
    );
    return mapKitRow(result.rows[0] as KitRow);
  }

  async findById(orgId: string, id: string, q: Queryable = this.db): Promise<Kit | null> {
    const result = await q.query(`SELECT ${KIT_COLUMNS} FROM kit WHERE id = $1 AND org_id = $2`, [
      id,
      orgId,
    ]);
    const row = result.rows[0] as KitRow | undefined;
    return row ? mapKitRow(row) : null;
  }

  /** Locks the kit row inside a transaction (publish, reorder). */
  async lockById(orgId: string, id: string, q: Queryable): Promise<Kit | null> {
    const result = await q.query(
      `SELECT ${KIT_COLUMNS} FROM kit WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [id, orgId],
    );
    const row = result.rows[0] as KitRow | undefined;
    return row ? mapKitRow(row) : null;
  }

  async listByOrg(orgId: string, status: KitStatus | undefined, q: Queryable): Promise<Kit[]> {
    const params: unknown[] = [orgId];
    let statusClause = '';
    if (status !== undefined) {
      params.push(status);
      statusClause = ' AND status = $2';
    }
    const result = await q.query(
      `SELECT ${KIT_COLUMNS} FROM kit WHERE org_id = $1${statusClause} ORDER BY updated_at DESC`,
      params,
    );
    return (result.rows as KitRow[]).map(mapKitRow);
  }

  /**
   * Guarded update. When expectedUpdatedAt is provided the write only lands
   * if the stored updated_at still matches (409 STALE_WRITE protocol).
   */
  async update(
    orgId: string,
    id: string,
    fields: KitUpdateFields,
    expectedUpdatedAt: string | undefined,
    q: Queryable,
  ): Promise<WriteOutcome<Kit>> {
    const assignments: string[] = [`updated_at = ${TRUNC_NOW}`];
    const params: unknown[] = [];
    const push = (clause: string, value: unknown): void => {
      params.push(value);
      assignments.push(`${clause} = $${params.length}`);
    };
    if (fields.title !== undefined) push('title', fields.title);
    if (fields.role !== undefined) push('role', fields.role);
    if (fields.level !== undefined) push('level', fields.level);
    if (fields.status !== undefined) push('status', fields.status);
    if (fields.settings !== undefined) {
      params.push(settingsToDbJson(fields.settings));
      assignments.push(`settings = $${params.length}::jsonb`);
    }
    params.push(id);
    const idParam = params.length;
    params.push(orgId);
    const orgParam = params.length;
    let guard = '';
    if (expectedUpdatedAt !== undefined) {
      params.push(expectedUpdatedAt);
      guard = ` AND updated_at = $${params.length}::timestamptz`;
    }
    const result = await q.query(
      `UPDATE kit SET ${assignments.join(', ')} WHERE id = $${idParam} AND org_id = $${orgParam}${guard} RETURNING ${KIT_COLUMNS}`,
      params,
    );
    const updated = result.rows[0] as KitRow | undefined;
    if (updated) {
      return { kind: 'ok', value: mapKitRow(updated) };
    }
    const current = await this.findById(orgId, id, q);
    return current ? { kind: 'stale', current } : { kind: 'missing' };
  }

  /** Bumps updated_at when the kit's question set changes (FR-E2-1 autosave). */
  async touchUpdatedAt(kitId: string, q: Queryable): Promise<void> {
    await q.query(`UPDATE kit SET updated_at = ${TRUNC_NOW} WHERE id = $1`, [kitId]);
  }

  /* ---- kit_version: insert-only by design (FR-E2-5 immutability) ---- */

  async maxVersion(kitId: string, q: Queryable): Promise<number> {
    const result = await q.query(
      'SELECT COALESCE(MAX(version), 0) AS max_version FROM kit_version WHERE kit_id = $1',
      [kitId],
    );
    return (result.rows[0] as { max_version: number }).max_version;
  }

  async insertVersion(
    input: { kitId: string; version: number; snapshot: KitSnapshot; publishedBy: string },
    q: Queryable,
  ): Promise<KitVersionSummary> {
    const result = await q.query(
      `INSERT INTO kit_version (kit_id, version, snapshot, published_by)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING ${VERSION_COLUMNS}`,
      [input.kitId, input.version, JSON.stringify(input.snapshot), input.publishedBy],
    );
    return mapVersionSummaryRow(result.rows[0] as KitVersionRow);
  }

  async listVersions(kitId: string, q: Queryable = this.db): Promise<KitVersionSummary[]> {
    const result = await q.query(
      `SELECT ${VERSION_COLUMNS} FROM kit_version WHERE kit_id = $1 ORDER BY version DESC`,
      [kitId],
    );
    return (result.rows as KitVersionRow[]).map(mapVersionSummaryRow);
  }

  async findVersion(
    kitId: string,
    version: number,
    q: Queryable = this.db,
  ): Promise<KitVersion | null> {
    const result = await q.query(
      `SELECT ${VERSION_COLUMNS} FROM kit_version WHERE kit_id = $1 AND version = $2`,
      [kitId, version],
    );
    const row = result.rows[0] as KitVersionRow | undefined;
    return row ? { ...mapVersionSummaryRow(row), snapshot: row.snapshot } : null;
  }

  // Intentionally no update/delete for kit_version: the immutability trigger
  // (migration 1784254913885) rejects both, and no service code path exists.
}
