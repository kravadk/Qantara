import { type Address } from 'viem';

import { db, nowSeconds } from '../db.js';
import { getInvoice, type Invoice } from './invoices.js';

interface InvoiceEvent {
  id: string;
  invoiceHash: `0x${string}`;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  message: string;
  invoiceHash: `0x${string}`;
  txHash?: `0x${string}`;
  blockNumber: number;
  timestamp: number;
  readAt?: number;
  dismissedAt?: number;
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

function notificationTitle(type: string): string {
  switch (type) {
    case 'invoice.created': return 'Invoice created';
    case 'invoice.viewed': return 'Invoice viewed';
    case 'message.created': return 'Deal room message';
    case 'invoice.paid': return 'Payment verified';
    case 'receipt.created': return 'Receipt ready';
    case 'invoice.cancelled': return 'Invoice cancelled';
    case 'invoice.refunded': return 'Invoice refunded';
    case 'invoice.paused': return 'Invoice paused';
    case 'invoice.resumed': return 'Invoice resumed';
    case 'webhook.failed': return 'Webhook delivery failed';
    default: return type.replace(/[._]/g, ' ');
  }
}

function notificationType(type: string): string {
  switch (type) {
    case 'invoice.created': return 'invoice_created';
    case 'invoice.viewed': return 'invoice_viewed';
    case 'message.created': return 'invoice_message';
    case 'invoice.paid': return 'invoice_paid';
    case 'receipt.created': return 'receipt_created';
    case 'invoice.cancelled': return 'invoice_cancelled';
    case 'invoice.refunded': return 'invoice_refunded';
    case 'webhook.failed': return 'webhook_failed';
    default: return type.replace(/[.]/g, '_');
  }
}

function notificationMessage(event: InvoiceEvent, invoice: Invoice): string {
  const payload = event.payload ?? {};
  if (event.type === 'message.created') {
    return String(payload.preview || payload.senderLabel || 'New message on invoice');
  }
  if (event.type === 'invoice.paid') {
    return `${invoice.amount} ${invoice.token.toLowerCase() === '0x0000000000000000000000000000000000000000' ? 'QIE' : 'QUSDC'} verified on QIE RPC`;
  }
  if (event.type === 'receipt.created') {
    return `Receipt ${String(payload.receiptHash || '').slice(0, 12)} is available`;
  }
  if (event.type === 'webhook.failed') {
    return String(payload.eventType || 'Webhook delivery failed');
  }
  return `${invoice.title || invoice.memo || invoice.hash.slice(0, 10)} updated`;
}

export function listNotifications(filter: { merchant: Address; limit?: number; offset?: number }): { notifications: NotificationRecord[]; total: number } {
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, Math.min(200, filter.limit ?? 100));
  const totalRow = db.prepare(`
    SELECT count(*) AS total
    FROM events e
    JOIN invoices i ON lower(i.hash) = lower(e.invoice_hash)
    LEFT JOIN notification_state ns
      ON ns.notification_id = e.id AND lower(ns.merchant) = lower(?)
    WHERE lower(i.merchant) = lower(?)
      AND ns.dismissed_at IS NULL
  `).get(filter.merchant, filter.merchant) as { total?: number } | undefined;
  const total = Number(totalRow?.total ?? 0);
  if (total === 0) return { notifications: [], total: 0 };

  const invoiceByHash = new Map<string, Invoice>();
  const rows = db.prepare(`
    SELECT e.*, ns.read_at, ns.dismissed_at
    FROM events e
    JOIN invoices i ON lower(i.hash) = lower(e.invoice_hash)
    LEFT JOIN notification_state ns
      ON ns.notification_id = e.id AND lower(ns.merchant) = lower(?)
    WHERE lower(i.merchant) = lower(?)
      AND ns.dismissed_at IS NULL
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ? OFFSET ?
  `).all(filter.merchant, filter.merchant, limit, offset) as any[];
  const all = rows.map((row): NotificationRecord | undefined => {
    const event = mapEvent(row);
    const invoice = invoiceByHash.get(event.invoiceHash.toLowerCase()) ?? getInvoice(event.invoiceHash);
    if (!invoice) return undefined;
    invoiceByHash.set(event.invoiceHash.toLowerCase(), invoice);
    return {
      id: event.id,
      type: notificationType(event.type),
      title: notificationTitle(event.type),
      message: notificationMessage(event, invoice),
      invoiceHash: event.invoiceHash,
      txHash: typeof event.payload.txHash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(event.payload.txHash)
        ? event.payload.txHash as `0x${string}`
        : invoice.paidTxHash as `0x${string}` | undefined,
      blockNumber: event.createdAt,
      timestamp: event.createdAt * 1000,
      readAt: row.read_at ?? undefined,
      dismissedAt: row.dismissed_at ?? undefined,
    };
  }).filter((notification): notification is NotificationRecord => Boolean(notification));
  return { notifications: all, total };
}

export function notificationBelongsToMerchant(merchant: Address, notificationId: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM events e
    JOIN invoices i ON lower(i.hash) = lower(e.invoice_hash)
    WHERE e.id = ? AND lower(i.merchant) = lower(?)
    LIMIT 1
  `).get(notificationId, merchant.toLowerCase());
  return Boolean(row);
}

export function setNotificationRead(merchant: Address, notificationId: string, read = true): boolean {
  if (!notificationBelongsToMerchant(merchant, notificationId)) return false;
  const ts = nowSeconds();
  db.prepare(`
    INSERT INTO notification_state (notification_id, merchant, read_at, dismissed_at, updated_at)
    VALUES (?, ?, ?, NULL, ?)
    ON CONFLICT(notification_id, merchant) DO UPDATE SET
      read_at = excluded.read_at,
      updated_at = excluded.updated_at
  `).run(notificationId, merchant.toLowerCase(), read ? ts : null, ts);
  return true;
}

export function dismissNotification(merchant: Address, notificationId: string): boolean {
  if (!notificationBelongsToMerchant(merchant, notificationId)) return false;
  const ts = nowSeconds();
  db.prepare(`
    INSERT INTO notification_state (notification_id, merchant, read_at, dismissed_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(notification_id, merchant) DO UPDATE SET
      read_at = COALESCE(notification_state.read_at, excluded.read_at),
      dismissed_at = excluded.dismissed_at,
      updated_at = excluded.updated_at
  `).run(notificationId, merchant.toLowerCase(), ts, ts, ts);
  return true;
}
