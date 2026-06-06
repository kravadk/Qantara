import { db, eventBus } from '../db.js';

export interface InvoiceEvent {
  id: string;
  invoiceHash: `0x${string}`;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

function safeJson<T>(raw: string | null | undefined, defaultValue: T): T {
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function mapEvent(row: any): InvoiceEvent {
  return {
    id: row.id,
    invoiceHash: row.invoice_hash,
    type: row.type,
    payload: safeJson(row.payload, {}),
    createdAt: row.created_at,
  };
}

export function getEvent(id: string): InvoiceEvent | undefined {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return row ? mapEvent(row) : undefined;
}

export function countInvoiceEvents(invoiceHash: string, type: string, sinceSeconds?: number): number {
  const row = sinceSeconds === undefined
    ? db.prepare('SELECT count(*) AS total FROM events WHERE lower(invoice_hash) = lower(?) AND type = ?').get(invoiceHash, type)
    : db.prepare(`
      SELECT count(*) AS total FROM events WHERE lower(invoice_hash) = lower(?) AND type = ? AND created_at >= ?
    `).get(invoiceHash, type, Math.max(0, Math.trunc(sinceSeconds)));
  return Number((row as { total?: number } | undefined)?.total ?? 0);
}

export function listEvents(invoiceHash: string, afterId?: string, page: { limit?: number; offset?: number } = {}): InvoiceEvent[] {
  const events = db.prepare(`
    SELECT * FROM events WHERE lower(invoice_hash) = lower(?) ORDER BY created_at ASC, rowid ASC
  `).all(invoiceHash).map(mapEvent);
  const afterEvents = afterId
    ? (() => {
        const idx = events.findIndex((event) => event.id === afterId);
        return idx >= 0 ? events.slice(idx + 1) : events;
      })()
    : events;
  const offset = Math.max(0, page.offset ?? 0);
  const defaultLimit = afterEvents.length > 0 ? afterEvents.length : 100;
  const limit = Math.max(1, Math.min(500, page.limit ?? defaultLimit));
  return afterEvents.slice(offset, offset + limit);
}

export function onInvoiceEvent(invoiceHash: string, handler: (event: InvoiceEvent) => void): () => void {
  const key = invoiceHash.toLowerCase();
  eventBus.on(key, handler);
  return () => eventBus.off(key, handler);
}

export function countEventsByType(type: string, sinceSeconds?: number): number {
  const row = sinceSeconds
    ? db.prepare('SELECT count(*) AS total FROM events WHERE type = ? AND created_at >= ?').get(type, sinceSeconds)
    : db.prepare('SELECT count(*) AS total FROM events WHERE type = ?').get(type);
  return Number((row as { total?: number } | undefined)?.total ?? 0);
}

export function listEventsByType(type: string, page: { limit?: number; offset?: number } = {}): InvoiceEvent[] {
  const limit = Math.max(1, Math.min(100, page.limit ?? 20));
  const offset = Math.max(0, page.offset ?? 0);
  return db.prepare(`
    SELECT * FROM events WHERE type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(type, limit, offset).map(mapEvent);
}
