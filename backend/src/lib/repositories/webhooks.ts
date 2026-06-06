import { type Address } from 'viem';

import { db, nowSeconds } from '../db.js';

export interface WebhookDelivery {
  id: string;
  invoiceHash: `0x${string}`;
  eventId?: string;
  eventType: string;
  targetUrl: string;
  status: number;
  attempts: number;
  lastError?: string;
  nextRetryAt?: number;
  eventPayload?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookEvent {
  type: string;
  deliveredAt: number;
  status: number;
  error?: string;
}

function safeJson<T>(raw: string | null | undefined, defaultValue: T): T {
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function mapWebhookDelivery(row: any): WebhookDelivery {
  return {
    id: row.id,
    invoiceHash: row.invoice_hash,
    eventId: row.event_id ?? undefined,
    eventType: row.event_type,
    targetUrl: row.target_url,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    nextRetryAt: row.next_retry_at ?? undefined,
    eventPayload: safeJson(row.event_payload, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function appendWebhookEvent(hash: string, ev: WebhookEvent) {
  const row = db.prepare('SELECT webhook_events FROM invoices WHERE lower(hash) = lower(?)').get(hash) as { webhook_events?: string } | undefined;
  if (!row) return;
  const events = [...safeJson<WebhookEvent[]>(row.webhook_events, []), ev];
  db.prepare('UPDATE invoices SET webhook_events = ? WHERE lower(hash) = lower(?)').run(JSON.stringify(events), hash);
}

export function upsertWebhookDelivery(input: {
  id: string;
  invoiceHash: string;
  eventId?: string;
  eventType: string;
  targetUrl: string;
  status: number;
  attempts: number;
  lastError?: string;
  nextRetryAt?: number;
  eventPayload?: Record<string, unknown>;
}): WebhookDelivery {
  const ts = nowSeconds();
  db.prepare(`
    INSERT INTO webhook_deliveries (
      id, invoice_hash, event_id, event_type, target_url, status, attempts, last_error, next_retry_at, event_payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      event_id = COALESCE(excluded.event_id, webhook_deliveries.event_id),
      status = excluded.status,
      attempts = excluded.attempts,
      last_error = excluded.last_error,
      next_retry_at = excluded.next_retry_at,
      event_payload = COALESCE(excluded.event_payload, webhook_deliveries.event_payload),
      updated_at = excluded.updated_at
  `).run(
    input.id,
    input.invoiceHash.toLowerCase(),
    input.eventId ?? null,
    input.eventType,
    input.targetUrl,
    input.status,
    input.attempts,
    input.lastError ?? null,
    input.nextRetryAt ?? null,
    input.eventPayload ? JSON.stringify(input.eventPayload) : null,
    ts,
    ts,
  );
  return getWebhookDelivery(input.id)!;
}

export function getWebhookDelivery(id: string): WebhookDelivery | undefined {
  const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id);
  return row ? mapWebhookDelivery(row) : undefined;
}

export function listWebhookDeliveries(filter: { invoiceHash?: string; merchant?: Address; limit?: number; offset?: number } = {}): { deliveries: WebhookDelivery[]; total: number } {
  const limit = Math.max(1, Math.min(200, filter.limit ?? 100));
  const offset = Math.max(0, filter.offset ?? 0);
  if (filter.merchant) {
    const clauses = ['lower(i.merchant) = lower(?)'];
    const params: Array<string | number> = [filter.merchant];
    if (filter.invoiceHash) {
      clauses.push('lower(w.invoice_hash) = lower(?)');
      params.push(filter.invoiceHash);
    }
    const deliveries = db
      .prepare(`
        SELECT w.*
        FROM webhook_deliveries w
        JOIN invoices i ON lower(i.hash) = lower(w.invoice_hash)
        WHERE ${clauses.join(' AND ')}
        ORDER BY w.updated_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset)
      .map(mapWebhookDelivery);
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS c
      FROM webhook_deliveries w
      JOIN invoices i ON lower(i.hash) = lower(w.invoice_hash)
      WHERE ${clauses.join(' AND ')}
    `).get(...params) as { c: number };
    return { deliveries, total: Number(totalRow?.c ?? 0) };
  }
  if (filter.invoiceHash) {
    const deliveries = db
      .prepare('SELECT * FROM webhook_deliveries WHERE lower(invoice_hash) = lower(?) ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(filter.invoiceHash, limit, offset)
      .map(mapWebhookDelivery);
    const totalRow = db.prepare('SELECT COUNT(*) AS c FROM webhook_deliveries WHERE lower(invoice_hash) = lower(?)').get(filter.invoiceHash) as { c: number };
    return { deliveries, total: Number(totalRow?.c ?? 0) };
  }
  const deliveries = db
    .prepare('SELECT * FROM webhook_deliveries ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map(mapWebhookDelivery);
  const totalRow = db.prepare('SELECT COUNT(*) AS c FROM webhook_deliveries').get() as { c: number };
  return { deliveries, total: Number(totalRow?.c ?? 0) };
}

export function listDueWebhookDeliveries(limit = 25): WebhookDelivery[] {
  const safeLimit = Math.max(1, Math.min(100, limit));
  return db
    .prepare(`
      SELECT * FROM webhook_deliveries
      WHERE next_retry_at IS NOT NULL AND next_retry_at <= ?
      ORDER BY next_retry_at ASC, updated_at ASC
      LIMIT ?
    `)
    .all(nowSeconds(), safeLimit)
    .map(mapWebhookDelivery);
}

export function webhookDeliveryStats(filter: { merchant?: Address } = {}): {
  total: number;
  failed: number;
  dueRetries: number;
  pendingRetries: number;
  maxAttempts: number;
  lastFailureAt?: number;
  recentFailures: WebhookDelivery[];
} {
  const now = nowSeconds();
  const join = filter.merchant ? ' JOIN invoices i ON lower(i.hash) = lower(w.invoice_hash)' : '';
  const where = filter.merchant ? ' WHERE lower(i.merchant) = lower(?)' : '';
  const params: Array<string | number> = filter.merchant ? [filter.merchant] : [];
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN w.status < 200 OR w.status >= 300 THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN w.next_retry_at IS NOT NULL AND w.next_retry_at <= ? THEN 1 ELSE 0 END), 0) AS due_retries,
      COALESCE(SUM(CASE WHEN w.next_retry_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS pending_retries,
      COALESCE(MAX(w.attempts), 0) AS max_attempts,
      COALESCE(MAX(CASE WHEN w.status < 200 OR w.status >= 300 THEN w.updated_at ELSE NULL END), 0) AS last_failure_at
    FROM webhook_deliveries w
    ${join}
    ${where}
  `).get(now, ...params) as {
    total?: number;
    failed?: number;
    due_retries?: number;
    pending_retries?: number;
    max_attempts?: number;
    last_failure_at?: number;
  } | undefined;
  const failureWhere = filter.merchant
    ? 'WHERE (w.status < 200 OR w.status >= 300) AND lower(i.merchant) = lower(?)'
    : 'WHERE w.status < 200 OR w.status >= 300';
  const recentFailures = db.prepare(`
    SELECT w.* FROM webhook_deliveries w
    ${join}
    ${failureWhere}
    ORDER BY w.updated_at DESC
    LIMIT 5
  `).all(...params).map(mapWebhookDelivery);
  return {
    total: Number(row?.total ?? 0),
    failed: Number(row?.failed ?? 0),
    dueRetries: Number(row?.due_retries ?? 0),
    pendingRetries: Number(row?.pending_retries ?? 0),
    maxAttempts: Number(row?.max_attempts ?? 0),
    lastFailureAt: row?.last_failure_at ? Number(row.last_failure_at) : undefined,
    recentFailures,
  };
}
