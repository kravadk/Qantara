import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { type Address } from 'viem';

import { db, nowSeconds } from '../db.js';

export interface ApiKey {
  id: string;
  name: string;
  merchant?: Address;
  scopes: string[];
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

function safeJson<T>(raw: string | null | undefined, defaultValue: T): T {
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function mapApiKey(row: any): ApiKey {
  return {
    id: row.id,
    name: row.name,
    merchant: row.merchant ?? undefined,
    scopes: safeJson(row.scopes, []),
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createApiKey(input: {
  name: string;
  merchant?: Address;
  scopes?: string[];
}): { apiKey: ApiKey; secret: string } {
  const id = `key_${randomUUID()}`;
  const secret = `qpk_${randomBytes(32).toString('base64url')}`;
  const prefix = secret.slice(0, 12);
  const scopes = input.scopes?.length
    ? input.scopes
    : [
        'invoices:read',
        'invoices:write',
        'webhooks:read',
        'webhooks:write',
        'notifications:read',
        'notifications:write',
        'receipts:read',
        'chain:read',
        'ops:read',
        'telegram:write',
      ];
  const ts = nowSeconds();
  db.prepare(`
    INSERT INTO api_keys (id, name, merchant, key_hash, prefix, scopes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim().slice(0, 80) || 'Merchant API key',
    input.merchant?.toLowerCase() ?? null,
    sha256Hex(secret),
    prefix,
    JSON.stringify(scopes),
    ts,
  );
  return { apiKey: getApiKey(id)!, secret };
}

export function getApiKey(id: string): ApiKey | undefined {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
  return row ? mapApiKey(row) : undefined;
}

export function listApiKeys(filter: { merchant?: Address } = {}): ApiKey[] {
  if (filter.merchant) {
    return db
      .prepare('SELECT * FROM api_keys WHERE lower(merchant) = lower(?) ORDER BY created_at DESC')
      .all(filter.merchant)
      .map(mapApiKey);
  }
  return db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all().map(mapApiKey);
}

export function revokeApiKey(id: string): ApiKey | undefined {
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowSeconds(), id);
  return getApiKey(id);
}

export function validateApiKey(secret: string, requiredScope?: string): ApiKey | undefined {
  const keyHash = sha256Hex(secret);
  const rows = db.prepare('SELECT * FROM api_keys WHERE revoked_at IS NULL').all() as any[];
  const row = rows.find((candidate) => constantTimeEqual(candidate.key_hash, keyHash));
  if (!row) return undefined;
  const apiKey = mapApiKey(row);
  if (requiredScope && !apiKey.scopes.includes(requiredScope) && !apiKey.scopes.includes('*')) return undefined;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowSeconds(), apiKey.id);
  return { ...apiKey, lastUsedAt: nowSeconds() };
}
