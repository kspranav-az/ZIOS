import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/errors';
import { ApiKeysRepository, type ApiKeyKind, type ApiKeyRecord } from './api-keys.repository';

export interface ApiKeyPublicView {
  id: string;
  kind: ApiKeyKind;
  prefix: string;
  label: string | null;
  scopes: string[];
  rateLimitPerMin: number;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKey extends ApiKeyPublicView {
  /** Full key, returned exactly once at creation/rotation. Never persisted. */
  key: string;
}

const KEY_PREFIX = 'zios';
const KEY_BODY_BYTES = 32;

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

@Injectable()
export class ApiKeysService {
  constructor(private readonly repo: ApiKeysRepository) {}

  /**
   * Generates a new `zios_{kind}_`-prefixed key, stores its sha256 hash and
   * returns the full key once. The raw key can never be recovered afterwards.
   */
  async create(input: {
    orgId: string;
    kind: ApiKeyKind;
    label?: string | null;
    scopes?: string[];
    rateLimitPerMin?: number;
    createdBy: string;
  }): Promise<CreatedApiKey> {
    const raw = generateRawKey(input.kind);
    const record = await this.repo.insert({
      orgId: input.orgId,
      kind: input.kind,
      keyHash: hashApiKey(raw),
      prefix: raw.slice(0, 12),
      label: input.label ?? null,
      scopes: input.scopes,
      rateLimitPerMin: input.rateLimitPerMin,
      createdBy: input.createdBy,
    });
    return { ...toPublicView(record), key: raw };
  }

  async list(orgId: string): Promise<ApiKeyPublicView[]> {
    const records = await this.repo.listByOrg(orgId);
    return records.map(toPublicView);
  }

  /**
   * Rotation issues a fresh key material for the same row: the old hash is
   * replaced, so previously distributed keys stop working immediately. The
   * new full key is returned once.
   */
  async rotate(orgId: string, keyId: string): Promise<CreatedApiKey> {
    const record = await this.assertOrgKey(orgId, keyId);
    if (record.revokedAt) {
      throw new ApiException(409, 'API_KEY_REVOKED', 'revoked keys cannot be rotated');
    }
    const raw = generateRawKey(record.kind);
    // Update hash + prefix + rotated_at in place; keep id/scopes/limits.
    const updated = await this.replaceKeyMaterial(record, raw);
    return { ...toPublicView(updated), key: raw };
  }

  async revoke(orgId: string, keyId: string): Promise<ApiKeyPublicView> {
    const record = await this.assertOrgKey(orgId, keyId);
    await this.repo.revoke(record.id);
    return toPublicView({ ...record, revokedAt: new Date().toISOString() });
  }

  /** Guard-facing lookup: sha256 → active key. */
  async findActiveByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    return this.repo.findActiveByHash(keyHash);
  }

  private async assertOrgKey(orgId: string, keyId: string): Promise<ApiKeyRecord> {
    const record = await this.repo.findById(keyId);
    if (!record || record.orgId !== orgId) {
      throw new ApiException(404, 'API_KEY_NOT_FOUND', 'api key not found');
    }
    return record;
  }

  private async replaceKeyMaterial(record: ApiKeyRecord, raw: string): Promise<ApiKeyRecord> {
    // Single statement keeps hash/prefix/rotated_at consistent.
    return this.repo.replaceKeyMaterial(record.id, hashApiKey(raw), raw.slice(0, 12));
  }
}

function generateRawKey(kind: ApiKeyKind): string {
  return `${KEY_PREFIX}_${kind}_${randomBytes(KEY_BODY_BYTES).toString('base64url')}`;
}

function toPublicView(record: ApiKeyRecord): ApiKeyPublicView {
  return {
    id: record.id,
    kind: record.kind,
    prefix: record.prefix,
    label: record.label,
    scopes: record.scopes,
    rateLimitPerMin: record.rateLimitPerMin,
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
    revokedAt: record.revokedAt,
  };
}
