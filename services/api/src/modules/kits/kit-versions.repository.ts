import { Injectable } from '@nestjs/common';
import type { KitSnapshot, KitVersionSummary } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

export interface KitVersionRow {
  id: string;
  kit_id: string;
  version: number;
  snapshot: KitSnapshot;
  published_by: string;
  published_at: Date;
}

@Injectable()
export class KitVersionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(
    id: string,
    q: Queryable = this.db,
  ): Promise<(KitVersionRow & { org_id: string }) | null> {
    const result = await q.query(
      `SELECT kv.id, kv.kit_id, kv.version, kv.snapshot, kv.published_by, kv.published_at, k.org_id
       FROM kit_version kv
       JOIN kit k ON k.id = kv.kit_id
       WHERE kv.id = $1`,
      [id],
    );
    const row = result.rows[0] as (KitVersionRow & { org_id: string }) | undefined;
    return row ?? null;
  }

  mapSummary(row: KitVersionRow): KitVersionSummary {
    return {
      id: row.id,
      kitId: row.kit_id,
      version: row.version,
      publishedBy: row.published_by,
      publishedAt: row.published_at.toISOString(),
    };
  }
}
