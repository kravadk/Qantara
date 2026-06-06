import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { encodePacked, keccak256, toHex, type Address } from 'viem';
import { db, eventBus, nowSeconds } from '../db.js';

export const InvoiceStatus = {
  Created: 0,
  Paid: 1,
  Cancelled: 2,
  Refunded: 3,
  Paused: 4,
} as const;
export type InvoiceStatusValue = typeof InvoiceStatus[keyof typeof InvoiceStatus];

export const InvoiceType = {
  Standard: 0,
  MultiPay: 1,
  Recurring: 2,
  Vesting: 3,
  Donation: 4,
} as const;
export type InvoiceTypeValue = typeof InvoiceType[keyof typeof InvoiceType];

export interface Invoice {
  hash: `0x${string}`;
  merchant: Address;
  payer: Address | null;
  token: Address;
  amount: string;
  invoiceType: InvoiceTypeValue;
  status: InvoiceStatusValue;
  createdAt: number;
  expiresAt: number;
  metadataHash: `0x${string}`;
  title?: string;
  memo?: string;
  paidAt?: number;
  paidTxHash?: string;
  webhookUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
  webhookEvents?: Array<{ type: string; deliveredAt: number; status: number; error?: string }>;
  guestToken?: string;
  metadata?: Record<string, unknown>;
}

export interface InvoiceEvent {
  id: string;
  invoiceHash: `0x${string}`;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export type ReceiptAnchorStatus = 'pending' | 'anchored' | 'failed';

export interface Receipt {
  id: string;
  invoiceHash: `0x${string}`;
  txHash: `0x${string}`;
  payer: Address;
  merchant: Address;
  amount: string;
  token: Address;
  issuedAt: number;
  receiptHash: `0x${string}`;
  anchoredAt?: number;
  anchorTxHash?: `0x${string}`;
  anchorStatus?: ReceiptAnchorStatus;
}

export interface CreateInvoiceInput {
  merchant: Address;
  amount: string;
  token?: Address;
  invoiceType?: InvoiceTypeValue;
  expiresAt?: number;
  title?: string;
  memo?: string;
  webhookUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
  hash?: `0x${string}`;
  chainTxHash?: `0x${string}`;
}

function safeJson<T>(raw: string | null | undefined, defaultValue: T): T {
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function mapInvoice(row: any): Invoice {
  return {
    hash: row.hash,
    merchant: row.merchant,
    payer: row.payer,
    token: row.token,
    amount: row.amount,
    invoiceType: row.invoice_type,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    metadataHash: row.metadata_hash,
    title: row.title ?? undefined,
    memo: row.memo ?? undefined,
    paidAt: row.paid_at ?? undefined,
    paidTxHash: row.paid_tx_hash ?? undefined,
    webhookUrl: row.webhook_url ?? undefined,
    successUrl: row.success_url ?? undefined,
    cancelUrl: row.cancel_url ?? undefined,
    webhookEvents: safeJson(row.webhook_events, []),
    guestToken: row.guest_token ?? undefined,
    metadata: safeJson(row.metadata, {}),
  };
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

function mapReceipt(row: any): Receipt {
  return {
    id: row.id,
    invoiceHash: row.invoice_hash,
    txHash: row.tx_hash,
    payer: row.payer,
    merchant: row.merchant,
    amount: row.amount,
    token: row.token,
    issuedAt: row.issued_at,
    receiptHash: row.receipt_hash,
    anchoredAt: row.anchored_at ?? undefined,
    anchorTxHash: row.anchor_tx_hash ?? undefined,
    anchorStatus: (row.anchor_status as ReceiptAnchorStatus | null) ?? undefined,
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emitInvoiceEvent(event: InvoiceEvent) {
  eventBus.emit(event.invoiceHash.toLowerCase(), event);
}

function insertInvoiceEvent(
  invoiceHash: string,
  type: string,
  payload: Record<string, unknown>,
  emit = true,
): InvoiceEvent {
  const id = `evt_${randomUUID()}`;
  const createdAt = nowSeconds();
  db.prepare('INSERT INTO events (id, invoice_hash, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, invoiceHash.toLowerCase(), type, JSON.stringify(payload ?? {}), createdAt);
  const event = getEvent(id)!;
  if (emit) emitInvoiceEvent(event);
  return event;
}

export function randomSalt(): `0x${string}` {
  return toHex(randomBytes(32));
}

export function computeInvoiceHash(
  salt: `0x${string}`,
  merchant: Address,
  blockNumber: bigint,
  blockTimestamp: bigint,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ['bytes32', 'address', 'uint256', 'uint256'],
      [salt, merchant, blockNumber, blockTimestamp],
    ),
  );
}

export function createInvoice(input: CreateInvoiceInput): Invoice {
  const ts = nowSeconds();
  const hash = input.hash
    ? (input.hash.toLowerCase() as `0x${string}`)
    : computeInvoiceHash(randomSalt(), input.merchant, BigInt(ts), BigInt(ts));

  const existing = getInvoice(hash);
  if (existing) return existing;

  const metadata = { ...(input.metadata ?? {}) };
  if (input.chainTxHash) {
    (metadata as Record<string, unknown>).chain_tx_hash = input.chainTxHash;
  }

  db.prepare(`
    INSERT INTO invoices (
      hash, merchant, payer, token, amount, invoice_type, status, created_at, expires_at,
      metadata_hash, title, memo, webhook_url, success_url, cancel_url, webhook_events, metadata
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
  `).run(
    hash,
    input.merchant.toLowerCase(),
    input.token ?? '0x0000000000000000000000000000000000000000',
    input.amount,
    input.invoiceType ?? InvoiceType.Standard,
    InvoiceStatus.Created,
    ts,
    input.expiresAt ?? 0,
    toHex(new Uint8Array(32)),
    input.title ?? null,
    input.memo ?? null,
    input.webhookUrl ?? null,
    input.successUrl ?? null,
    input.cancelUrl ?? null,
    JSON.stringify(metadata),
  );

  appendInvoiceEvent(hash, 'invoice.created', {
    amount: input.amount,
    merchant: input.merchant.toLowerCase(),
    ...(input.chainTxHash ? { chain_tx_hash: input.chainTxHash } : {}),
  });
  return getInvoice(hash)!;
}

export function getInvoice(hash: string): Invoice | undefined {
  const row = db.prepare('SELECT * FROM invoices WHERE lower(hash) = lower(?)').get(hash);
  return row ? mapInvoice(row) : undefined;
}

export function getInvoiceBySessionId(sessionId: string): Invoice | undefined {
  if (!/^cs_[a-fA-F0-9]{16}$/.test(sessionId)) return undefined;
  const hashPrefix = sessionId.slice(3).toLowerCase();
  const row = db.prepare('SELECT * FROM invoices WHERE substr(lower(hash), 3, 16) = ?').get(hashPrefix);
  return row ? mapInvoice(row) : undefined;
}

export function markPaid(hash: string, payer: Address, txHash: `0x${string}`): Invoice | undefined {
  const events: InvoiceEvent[] = [];
  let updated: Invoice | undefined;
  db.exec('BEGIN IMMEDIATE');
  try {
    const inv = getInvoice(hash);
    if (!inv) {
      db.exec('ROLLBACK');
      return undefined;
    }
    if (inv.status !== InvoiceStatus.Created) {
      throw new Error(`Cannot mark paid: status is ${inv.status}`);
    }
    const paidAt = nowSeconds();
    db.prepare(`
      UPDATE invoices SET status = ?, payer = ?, paid_at = ?, paid_tx_hash = ? WHERE lower(hash) = lower(?)
    `).run(InvoiceStatus.Paid, payer.toLowerCase(), paidAt, txHash, hash);
    events.push(insertInvoiceEvent(inv.hash, 'invoice.paid', { payer: payer.toLowerCase(), txHash }, false));
    updated = getInvoice(hash);
    if (!updated) throw new Error('invoice_not_found_after_payment_update');
    const receipt = issueReceiptForPaidInvoice(updated, false, events);
    if (!receipt) throw new Error('receipt_not_issued');
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction may already be closed by SQLite after a commit failure.
    }
    throw err;
  }
  for (const event of events) emitInvoiceEvent(event);
  return updated;
}

export function issueReceipt(inv: Invoice): Receipt | undefined {
  return issueReceiptForPaidInvoice(inv, true);
}

function issueReceiptForPaidInvoice(inv: Invoice, emitEvent: boolean, collectedEvents?: InvoiceEvent[]): Receipt | undefined {
  if (inv.status !== InvoiceStatus.Paid || !inv.payer || !inv.paidTxHash || !inv.paidAt) return undefined;
  const existing = getReceipt(inv.hash);
  if (existing) return existing;
  const id = `rcpt_${randomUUID()}`;
  const issuedAt = nowSeconds();
  const receiptHash = `0x${sha256Hex([
    inv.hash,
    inv.paidTxHash,
    inv.payer,
    inv.merchant,
    inv.amount,
    inv.token,
    String(issuedAt),
  ].join('|'))}` as `0x${string}`;
  db.prepare(`
    INSERT INTO receipts (id, invoice_hash, tx_hash, payer, merchant, amount, token, issued_at, receipt_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    inv.hash,
    inv.paidTxHash,
    inv.payer.toLowerCase(),
    inv.merchant.toLowerCase(),
    inv.amount,
    inv.token.toLowerCase(),
    issuedAt,
    receiptHash,
  );
  const event = insertInvoiceEvent(inv.hash, 'receipt.created', { receiptId: id, receiptHash, txHash: inv.paidTxHash }, emitEvent);
  if (!emitEvent) collectedEvents?.push(event);
  return getReceipt(inv.hash);
}

export function getReceipt(invoiceHash: string): Receipt | undefined {
  const row = db.prepare('SELECT * FROM receipts WHERE lower(invoice_hash) = lower(?)').get(invoiceHash);
  return row ? mapReceipt(row) : undefined;
}

export function listReceipts(filter: { merchant?: Address; limit?: number; offset?: number } = {}): { receipts: Receipt[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.merchant) {
    clauses.push('lower(merchant) = lower(?)');
    params.push(filter.merchant);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM receipts${where}`).get(...params) as { c: number };
  const limit = Math.max(1, Math.min(200, filter.limit ?? 100));
  const offset = Math.max(0, filter.offset ?? 0);
  const receipts = db
    .prepare(`SELECT * FROM receipts${where} ORDER BY issued_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(mapReceipt);
  return { receipts, total: Number(totalRow?.c ?? 0) };
}

/**
 * Receipts that are eligible for on-chain anchoring: never anchored and not in a
 * terminal anchored state. `failed` rows are included so a later retry can pick them up.
 */
export function listUnanchoredReceipts(limit = 25): Receipt[] {
  const capped = Math.max(1, Math.min(200, limit));
  return db
    .prepare(
      `SELECT * FROM receipts
       WHERE anchored_at IS NULL
         AND (anchor_status IS NULL OR anchor_status IN ('pending', 'failed'))
       ORDER BY issued_at ASC
       LIMIT ?`,
    )
    .all(capped)
    .map(mapReceipt);
}

export function markReceiptAnchored(
  invoiceHash: string,
  anchorTxHash: `0x${string}` | null,
  anchoredAt: number = nowSeconds(),
): Receipt | undefined {
  db.prepare(
    `UPDATE receipts
     SET anchored_at = ?, anchor_tx_hash = ?, anchor_status = 'anchored'
     WHERE lower(invoice_hash) = lower(?)`,
  ).run(anchoredAt, anchorTxHash, invoiceHash);
  return getReceipt(invoiceHash);
}

export function markReceiptAnchorFailed(invoiceHash: string): Receipt | undefined {
  db.prepare(
    `UPDATE receipts
     SET anchor_status = 'failed'
     WHERE lower(invoice_hash) = lower(?) AND anchored_at IS NULL`,
  ).run(invoiceHash);
  return getReceipt(invoiceHash);
}

export function cancelInvoice(hash: string): Invoice | undefined {
  const inv = getInvoice(hash);
  if (!inv) return undefined;
  if (inv.status !== InvoiceStatus.Created && inv.status !== InvoiceStatus.Paused) {
    throw new Error('Only Created or Paused invoices can be cancelled');
  }
  db.prepare('UPDATE invoices SET status = ? WHERE lower(hash) = lower(?)').run(InvoiceStatus.Cancelled, hash);
  appendInvoiceEvent(inv.hash, 'invoice.cancelled', {});
  return getInvoice(hash);
}

export function refundInvoice(hash: string, reason?: string): Invoice | undefined {
  const inv = getInvoice(hash);
  if (!inv) return undefined;
  if (inv.status !== InvoiceStatus.Paid) {
    throw new Error('Only Paid invoices can be refunded');
  }
  db.prepare('UPDATE invoices SET status = ? WHERE lower(hash) = lower(?)').run(InvoiceStatus.Refunded, hash);
  appendInvoiceEvent(inv.hash, 'invoice.refunded', { reason: reason ?? undefined });
  return getInvoice(hash);
}

export function pauseInvoice(hash: string): Invoice | undefined {
  const inv = getInvoice(hash);
  if (!inv) return undefined;
  if (inv.status !== InvoiceStatus.Created) {
    throw new Error('Only Created invoices can be paused');
  }
  db.prepare('UPDATE invoices SET status = ? WHERE lower(hash) = lower(?)').run(InvoiceStatus.Paused, hash);
  appendInvoiceEvent(inv.hash, 'invoice.paused', {});
  return getInvoice(hash);
}

export function resumeInvoice(hash: string): Invoice | undefined {
  const inv = getInvoice(hash);
  if (!inv) return undefined;
  if (inv.status !== InvoiceStatus.Paused) {
    throw new Error('Only Paused invoices can be resumed');
  }
  db.prepare('UPDATE invoices SET status = ? WHERE lower(hash) = lower(?)').run(InvoiceStatus.Created, hash);
  appendInvoiceEvent(inv.hash, 'invoice.resumed', {});
  return getInvoice(hash);
}

export function listInvoices(
  filter: {
    invoiceHash?: string;
    merchant?: Address;
    payer?: Address;
    token?: Address;
    status?: InvoiceStatusValue;
    demo?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): { invoices: Invoice[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.invoiceHash) {
    clauses.push('lower(hash) = lower(?)');
    params.push(filter.invoiceHash);
  }
  if (filter.merchant) {
    clauses.push('lower(merchant) = lower(?)');
    params.push(filter.merchant);
  }
  if (filter.payer) {
    clauses.push('lower(payer) = lower(?)');
    params.push(filter.payer);
  }
  if (filter.token) {
    clauses.push('lower(token) = lower(?)');
    params.push(filter.token);
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter.demo !== undefined) {
    clauses.push("json_extract(metadata, '$.demo') = ?");
    params.push(filter.demo ? 1 : 0);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM invoices${where}`).get(...params) as { c: number };
  const total = Number(totalRow?.c ?? 0);
  const limit = Math.max(1, Math.min(200, filter.limit ?? 100));
  const offset = Math.max(0, filter.offset ?? 0);
  const rows = db
    .prepare(`SELECT * FROM invoices${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(mapInvoice);
  return { invoices: rows, total };
}

export function getEvent(id: string): InvoiceEvent | undefined {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return row ? mapEvent(row) : undefined;
}

export function appendInvoiceEvent(
  invoiceHash: string,
  type: string,
  payload: Record<string, unknown>,
): InvoiceEvent {
  return insertInvoiceEvent(invoiceHash, type, payload, true);
}
