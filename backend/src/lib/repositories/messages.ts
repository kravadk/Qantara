import { randomBytes, randomUUID } from 'node:crypto';
import type { Address } from 'viem';
import { db, nowSeconds } from '../db.js';
import { appendInvoiceEvent, getInvoice } from './invoices.js';

export interface Message {
  id: string;
  invoiceHash: `0x${string}`;
  senderRole: 'merchant' | 'payer' | 'system';
  senderAddress?: Address;
  senderLabel?: string;
  body: string;
  createdAt: number;
  readAt?: number;
}

export interface CreateMessageInput {
  invoiceHash: string;
  senderRole: Message['senderRole'];
  senderAddress?: Address;
  senderLabel?: string;
  body: string;
  guestToken?: string;
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    invoiceHash: row.invoice_hash,
    senderRole: row.sender_role,
    senderAddress: row.sender_address ?? undefined,
    senderLabel: row.sender_label ?? undefined,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  };
}

function randomToken(): string {
  return `gst_${randomBytes(24).toString('base64url')}`;
}

export function sanitizeMessageBody(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function createMessage(input: CreateMessageInput): { message: Message; guestToken?: string } | undefined {
  const inv = getInvoice(input.invoiceHash);
  if (!inv) return undefined;

  const senderRole = input.senderRole;
  if (!['merchant', 'payer', 'system'].includes(senderRole)) {
    throw new Error('sender_role must be merchant, payer, or system');
  }
  if (typeof input.body !== 'string') {
    throw new Error('message body is required');
  }
  const body = sanitizeMessageBody(input.body);
  if (!body) {
    throw new Error('message body is required');
  }

  let guestToken: string | undefined;
  if (senderRole === 'payer') {
    if (inv.guestToken && input.guestToken !== inv.guestToken) {
      throw new Error('invalid guest token');
    }
    guestToken = inv.guestToken ?? randomToken();
    if (!inv.guestToken) {
      db.prepare('UPDATE invoices SET guest_token = ? WHERE lower(hash) = lower(?)').run(guestToken, input.invoiceHash);
    }
  }

  const id = `msg_${randomUUID()}`;
  const createdAt = nowSeconds();
  db.prepare(`
    INSERT INTO messages (id, invoice_hash, sender_role, sender_address, sender_label, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    inv.hash,
    senderRole,
    input.senderAddress?.toLowerCase() ?? null,
    input.senderLabel?.trim().slice(0, 80) || null,
    body,
    createdAt,
  );

  const message = getMessage(id)!;
  appendInvoiceEvent(inv.hash, 'message.created', {
    messageId: id,
    senderRole,
    senderLabel: message.senderLabel,
    preview: body.slice(0, 120),
  });
  return { message, guestToken };
}

export function getMessage(id: string): Message | undefined {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  return row ? mapMessage(row) : undefined;
}

export function listMessages(invoiceHash: string, page: { limit?: number; offset?: number } = {}): Message[] {
  const limit = Math.max(1, Math.min(500, page.limit ?? 100));
  const offset = Math.max(0, page.offset ?? 0);
  return db.prepare(`
    SELECT * FROM messages WHERE lower(invoice_hash) = lower(?) ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?
  `).all(invoiceHash, limit, offset).map(mapMessage);
}

export function countMessages(invoiceHash: string): number {
  const row = db.prepare('SELECT count(*) AS total FROM messages WHERE lower(invoice_hash) = lower(?)').get(invoiceHash) as
    | { total: number }
    | undefined;
  return Number(row?.total ?? 0);
}

export function countRecentMessages(invoiceHash: string, sinceSeconds: number): number {
  const row = db.prepare(`
    SELECT count(*) AS total FROM messages WHERE lower(invoice_hash) = lower(?) AND created_at >= ?
  `).get(invoiceHash, Math.max(0, Math.trunc(sinceSeconds))) as
    | { total: number }
    | undefined;
  return Number(row?.total ?? 0);
}

export function markMessageRead(invoiceHash: string, id: string): Message | undefined {
  db.prepare(`
    UPDATE messages SET read_at = ? WHERE id = ? AND lower(invoice_hash) = lower(?)
  `).run(nowSeconds(), id, invoiceHash);
  return getMessage(id);
}
