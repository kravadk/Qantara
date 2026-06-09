/**
 * SQLite-backed invoice store.
 * Keeps the original synchronous interface while making checkout/chat state durable in SQLite.
 */

import { randomBytes } from 'node:crypto';
import { keccak256, encodePacked, toHex, type Address } from 'viem';
import { db, eventBus, nowSeconds } from './db.js';
export { closeDatabase, migrationStatus, type SchemaMigration } from './db.js';

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

export interface TelegramLink {
  invoiceHash: `0x${string}`;
  chatId: string;
  creatorId?: string;
  createdAt: number;
}

export interface OperationalAlertDelivery {
  alertId: string;
  severity: 'warning' | 'critical';
  status: number;
  attempts: number;
  lastValue?: number;
  lastThreshold?: number;
  lastError?: string;
  lastSentAt?: number;
  updatedAt: number;
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
  /** If the invoice was created on-chain first, pass the contract-computed hash here. */
  hash?: `0x${string}`;
  /** Transaction hash of on-chain createInvoice call (for explorer linking). */
  chainTxHash?: `0x${string}`;
}

export interface CreateMessageInput {
  invoiceHash: string;
  senderRole: Message['senderRole'];
  senderAddress?: Address;
  senderLabel?: string;
  body: string;
  guestToken?: string;
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

function mapOperationalAlertDelivery(row: any): OperationalAlertDelivery {
  return {
    alertId: row.alert_id,
    severity: row.severity,
    status: Number(row.status),
    attempts: Number(row.attempts),
    lastValue: row.last_value ?? undefined,
    lastThreshold: row.last_threshold ?? undefined,
    lastError: row.last_error ?? undefined,
    lastSentAt: row.last_sent_at ?? undefined,
    updatedAt: Number(row.updated_at),
  };
}

function safeJson<T>(raw: string | null | undefined, defaultValue: T): T {
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function randomToken(): string {
  return `gst_${randomBytes(24).toString('base64url')}`;
}

export {
  countMessages,
  countRecentMessages,
  createMessage,
  getMessage,
  listMessages,
  markMessageRead,
  sanitizeMessageBody,
} from './repositories/messages.js';
import {
  countMessages,
  countRecentMessages,
  createMessage,
  getMessage,
  listMessages,
  markMessageRead,
  sanitizeMessageBody,
} from './repositories/messages.js';

export {
  appendInvoiceEvent,
  cancelInvoice,
  computeInvoiceHash,
  createInvoice,
  getInvoiceBySessionId,
  getInvoice,
  getReceipt,
  issueReceipt,
  listInvoices,
  listReceipts,
  listUnanchoredReceipts,
  markPaid,
  markReceiptAnchored,
  markReceiptAnchorFailed,
  pauseInvoice,
  randomSalt,
  refundInvoice,
  resumeInvoice,
} from './repositories/invoices.js';
import {
  appendInvoiceEvent,
  cancelInvoice,
  computeInvoiceHash,
  createInvoice,
  getInvoiceBySessionId,
  getInvoice,
  getReceipt,
  issueReceipt,
  listInvoices,
  listReceipts,
  listUnanchoredReceipts,
  markPaid,
  markReceiptAnchored,
  markReceiptAnchorFailed,
  pauseInvoice,
  randomSalt,
  refundInvoice,
  resumeInvoice,
} from './repositories/invoices.js';
export {
  countEventsByType,
  countInvoiceEvents,
  getEvent,
  listEvents,
  listEventsByType,
  onInvoiceEvent,
} from './repositories/events.js';
import {
  countEventsByType,
  countInvoiceEvents,
  getEvent,
  listEvents,
  listEventsByType,
  onInvoiceEvent,
} from './repositories/events.js';
export {
  appendWebhookEvent,
  getWebhookDelivery,
  listDueWebhookDeliveries,
  listWebhookDeliveries,
  upsertWebhookDelivery,
  webhookDeliveryStats,
} from './repositories/webhooks.js';
import {
  appendWebhookEvent,
  getWebhookDelivery,
  listDueWebhookDeliveries,
  listWebhookDeliveries,
  upsertWebhookDelivery,
  webhookDeliveryStats,
} from './repositories/webhooks.js';
export {
  billingSummary,
  countMerchantPaid,
  explorerStats,
  getMerchantProfile,
  listMerchantPayers,
  listPublicMerchants,
  markMerchantDomainVerified,
  merchantAnalytics,
  setMerchantDomainChallenge,
  upsertMerchantProfile,
  type BillingSummary,
  type BillingTokenVolume,
  type ExplorerStats,
  type MerchantAnalytics,
  type MerchantPayer,
  type MerchantProfile,
} from './repositories/merchants.js';
import {
  billingSummary,
  countMerchantPaid,
  explorerStats,
  getMerchantProfile,
  listMerchantPayers,
  listPublicMerchants,
  markMerchantDomainVerified,
  merchantAnalytics,
  setMerchantDomainChallenge,
  upsertMerchantProfile,
} from './repositories/merchants.js';
export {
  createApiKey,
  getApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
  type ApiKey,
} from './repositories/apiKeys.js';
import {
  createApiKey,
  getApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
} from './repositories/apiKeys.js';
export {
  createPaymentIntent,
  getPaymentIntent,
  listPaymentIntents,
  markPaymentIntentUsed,
  type PaymentIntent,
} from './repositories/paymentIntents.js';
import {
  createPaymentIntent,
  getPaymentIntent,
  listPaymentIntents,
  markPaymentIntentUsed,
} from './repositories/paymentIntents.js';
export {
  dismissNotification,
  listNotifications,
  notificationBelongsToMerchant,
  setNotificationRead,
  type NotificationRecord,
} from './repositories/notifications.js';
import {
  dismissNotification,
  listNotifications,
  notificationBelongsToMerchant,
  setNotificationRead,
} from './repositories/notifications.js';
export {
  applyIndexedInvoiceState,
  chainSyncStatus,
  countChainEvents,
  getChainCursor,
  getChainCursorState,
  getChainEvent,
  listChainEvents,
  recordChainEvent,
  rollbackChainCursor,
  setChainCursor,
  type ChainCursor,
  type ChainEvent,
  type InvoiceSyncState,
} from './repositories/chain.js';
import {
  applyIndexedInvoiceState,
  chainSyncStatus,
  countChainEvents,
  getChainCursor,
  getChainCursorState,
  getChainEvent,
  listChainEvents,
  recordChainEvent,
  rollbackChainCursor,
  setChainCursor,
} from './repositories/chain.js';

export function getOperationalAlertDelivery(alertId: string): OperationalAlertDelivery | undefined {
  const row = db.prepare('SELECT * FROM operational_alert_deliveries WHERE alert_id = ?').get(alertId);
  return row ? mapOperationalAlertDelivery(row) : undefined;
}

export function upsertOperationalAlertDelivery(input: {
  alertId: string;
  severity: 'warning' | 'critical';
  status: number;
  attempts: number;
  lastValue?: number;
  lastThreshold?: number;
  lastError?: string;
  lastSentAt?: number;
}): OperationalAlertDelivery {
  const ts = nowSeconds();
  db.prepare(`
    INSERT INTO operational_alert_deliveries (
      alert_id, severity, status, attempts, last_value, last_threshold, last_error, last_sent_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(alert_id) DO UPDATE SET
      severity = excluded.severity,
      status = excluded.status,
      attempts = excluded.attempts,
      last_value = excluded.last_value,
      last_threshold = excluded.last_threshold,
      last_error = excluded.last_error,
      last_sent_at = excluded.last_sent_at,
      updated_at = excluded.updated_at
  `).run(
    input.alertId,
    input.severity,
    input.status,
    input.attempts,
    input.lastValue ?? null,
    input.lastThreshold ?? null,
    input.lastError ?? null,
    input.lastSentAt ?? null,
    ts,
  );
  return getOperationalAlertDelivery(input.alertId)!;
}

export function listOperationalAlertDeliveries(): OperationalAlertDelivery[] {
  return db.prepare('SELECT * FROM operational_alert_deliveries ORDER BY updated_at DESC').all().map(mapOperationalAlertDelivery);
}

export function hasConversationAccess(
  hash: string,
  options: { isMerchant?: boolean; guestToken?: string },
): boolean {
  if (options.isMerchant) return true;
  const inv = getInvoice(hash);
  if (!inv) return false;
  // Claimed conversation: only the payer holding the bound guest token may access it.
  if (inv.guestToken) return options.guestToken === inv.guestToken;
  // Unclaimed conversation (no payer guest token bound yet): the invoice-link holder may read
  // and start it WITHOUT a token — even if the merchant posted the first message. Presenting a
  // (foreign/stale) token here is still rejected so one invoice's token can't read another's.
  return !options.guestToken;
}

export interface MerchantWebhookSecret {
  secret: string;
  createdAt: number;
  rotatedAt: number;
}

export function getMerchantWebhookSecret(merchant: Address): MerchantWebhookSecret | undefined {
  const row = db
    .prepare('SELECT secret, created_at, rotated_at FROM merchant_webhook_secrets WHERE lower(merchant) = lower(?)')
    .get(merchant) as { secret: string; created_at: number; rotated_at: number } | undefined;
  return row ? { secret: row.secret, createdAt: row.created_at, rotatedAt: row.rotated_at } : undefined;
}

/** Returns the merchant's webhook signing secret, lazily generating a unique one on first use. */
export function ensureMerchantWebhookSecret(merchant: Address): MerchantWebhookSecret {
  const existing = getMerchantWebhookSecret(merchant);
  if (existing) return existing;
  const ts = nowSeconds();
  db.prepare(
    `INSERT INTO merchant_webhook_secrets (merchant, secret, created_at, rotated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(merchant) DO NOTHING`,
  ).run(merchant.toLowerCase(), `whsec_${randomBytes(32).toString('base64url')}`, ts, ts);
  return getMerchantWebhookSecret(merchant)!;
}

export function rotateMerchantWebhookSecret(merchant: Address): MerchantWebhookSecret {
  const ts = nowSeconds();
  db.prepare(
    `INSERT INTO merchant_webhook_secrets (merchant, secret, created_at, rotated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(merchant) DO UPDATE SET secret = excluded.secret, rotated_at = excluded.rotated_at`,
  ).run(merchant.toLowerCase(), `whsec_${randomBytes(32).toString('base64url')}`, ts, ts);
  return getMerchantWebhookSecret(merchant)!;
}

export interface MerchantTelegramChat {
  merchant: Address;
  chatId: string;
  creatorId?: string;
  updatedAt: number;
}

/** Per-merchant default Telegram chat for routing notifications (multi-tenant Telegram). */
export function getMerchantTelegramChat(merchant: Address): MerchantTelegramChat | undefined {
  const row = db
    .prepare('SELECT merchant, chat_id, creator_id, updated_at FROM merchant_telegram_chats WHERE lower(merchant) = lower(?)')
    .get(merchant) as { merchant: string; chat_id: string; creator_id: string | null; updated_at: number } | undefined;
  return row
    ? { merchant: row.merchant as Address, chatId: row.chat_id, creatorId: row.creator_id ?? undefined, updatedAt: row.updated_at }
    : undefined;
}

export function setMerchantTelegramChat(input: { merchant: Address; chatId: string; creatorId?: string }): MerchantTelegramChat {
  const ts = nowSeconds();
  db.prepare(
    `INSERT INTO merchant_telegram_chats (merchant, chat_id, creator_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(merchant) DO UPDATE SET chat_id = excluded.chat_id, creator_id = excluded.creator_id, updated_at = excluded.updated_at`,
  ).run(input.merchant.toLowerCase(), input.chatId, input.creatorId ?? null, ts);
  return getMerchantTelegramChat(input.merchant)!;
}

export function deleteMerchantTelegramChat(merchant: Address): boolean {
  const info = db.prepare('DELETE FROM merchant_telegram_chats WHERE lower(merchant) = lower(?)').run(merchant);
  return info.changes > 0;
}

function mapTelegramLink(row: any): TelegramLink {
  return {
    invoiceHash: row.invoice_hash,
    chatId: row.chat_id,
    creatorId: row.creator_id ?? undefined,
    createdAt: Number(row.created_at),
  };
}

export function saveTelegramLink(input: { invoiceHash: string; chatId: string; creatorId?: string }): TelegramLink {
  const inv = getInvoice(input.invoiceHash);
  if (!inv) throw new Error('invoice_not_found');
  const chatId = input.chatId.trim();
  if (!chatId) throw new Error('chat_id_required');
  if (!/^-?\d{1,20}$/.test(chatId)) throw new Error('invalid_chat_id');
  const creatorId = input.creatorId?.trim();
  if (creatorId && !/^\d{1,20}$/.test(creatorId)) throw new Error('invalid_creator_id');
  db.prepare(`
    INSERT INTO telegram_links (invoice_hash, chat_id, creator_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(invoice_hash) DO UPDATE SET
      chat_id = excluded.chat_id,
      creator_id = excluded.creator_id
  `).run(inv.hash, chatId, creatorId || null, nowSeconds());
  return getTelegramLink(inv.hash)!;
}

export function getTelegramLink(invoiceHash: string): TelegramLink | undefined {
  const row = db.prepare('SELECT * FROM telegram_links WHERE lower(invoice_hash) = lower(?)').get(invoiceHash);
  return row ? mapTelegramLink(row) : undefined;
}

export function listTelegramLinks(filter: { chatId?: string; limit?: number; offset?: number } = {}): { links: TelegramLink[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.chatId) {
    clauses.push('chat_id = ?');
    params.push(filter.chatId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM telegram_links${where}`).get(...params) as { c: number };
  const limit = Math.max(1, Math.min(100, filter.limit ?? 25));
  const offset = Math.max(0, filter.offset ?? 0);
  const links = db
    .prepare(`SELECT * FROM telegram_links${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(mapTelegramLink);
  return { links, total: Number(totalRow?.c ?? 0) };
}

export function clearAll() {
  db.exec(`
    DELETE FROM webhook_deliveries;
    DELETE FROM chain_events;
    DELETE FROM chain_cursor;
    DELETE FROM invoice_sync_state;
    DELETE FROM operational_alert_deliveries;
    DELETE FROM receipts;
    DELETE FROM payment_intents;
    DELETE FROM messages;
    DELETE FROM events;
    DELETE FROM telegram_links;
    DELETE FROM invoices;
    DELETE FROM siwe_nonces;
    DELETE FROM api_keys;
  `);
}

// ---------- SIWE nonces ----------

export function saveNonce(nonce: string, ttlMs = 10 * 60_000): void {
  const expiresAt = Date.now() + ttlMs;
  db.prepare('INSERT OR REPLACE INTO siwe_nonces (nonce, expires_at) VALUES (?, ?)').run(nonce, expiresAt);
  // Lazy cleanup of expired nonces (cheap; runs ~once per insert).
  db.prepare('DELETE FROM siwe_nonces WHERE expires_at < ?').run(Date.now());
}

/** Atomically consume a nonce — returns true if it existed and was unexpired. */
export function consumeNonce(nonce: string): boolean {
  const result = db.prepare('DELETE FROM siwe_nonces WHERE nonce = ? AND expires_at > ?').run(nonce, Date.now());
  return result.changes === 1;
}

// ---------- Relay log (gasless txs) ----------

export interface RelayLogRow {
  id: string;
  fromAddr: string;
  target: string;
  selector: string;
  txHash?: string;
  value: string;
  gasUsed?: string;
  createdAt: number;
}

export function logRelay(row: Omit<RelayLogRow, 'createdAt'> & { createdAt?: number }): void {
  const ts = row.createdAt ?? Date.now();
  db.prepare(
    'INSERT INTO relay_log (id, from_addr, target, selector, tx_hash, value, gas_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.fromAddr.toLowerCase(), row.target.toLowerCase(), row.selector, row.txHash ?? null, row.value, row.gasUsed ?? null, ts);
}

export function countRelaysToday(fromAddr: string): number {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const row = db
    .prepare('SELECT count(*) AS count FROM relay_log WHERE from_addr = ? AND created_at > ?')
    .get(fromAddr.toLowerCase(), since) as { count: number };
  return Number(row.count);
}

export function recentRelays(limit = 20): RelayLogRow[] {
  const rows = db
    .prepare(
      'SELECT id, from_addr AS fromAddr, target, selector, tx_hash AS txHash, value, gas_used AS gasUsed, created_at AS createdAt FROM relay_log ORDER BY created_at DESC LIMIT ?',
    )
    .all(limit) as unknown as RelayLogRow[];
  return rows;
}

// ---------- Onramp orders ----------

export interface OnrampOrderRow {
  id: string;
  provider: 'moonpay' | 'transak' | string;
  externalId: string;
  walletAddr: string;
  amountFiat?: string;
  currencyFiat?: string;
  amountCrypto?: string;
  currencyCrypto?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | string;
  invoiceHash?: string;
  createdAt: number;
  updatedAt: number;
}

export function upsertOnrampOrder(row: Omit<OnrampOrderRow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): void {
  const id = row.id ?? `${row.provider}:${row.externalId}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO onramp_orders
       (id, provider, external_id, wallet_addr, amount_fiat, currency_fiat, amount_crypto, currency_crypto, status, invoice_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       amount_fiat = COALESCE(excluded.amount_fiat, onramp_orders.amount_fiat),
       amount_crypto = COALESCE(excluded.amount_crypto, onramp_orders.amount_crypto),
       updated_at = excluded.updated_at`,
  ).run(
    id, row.provider, row.externalId, row.walletAddr.toLowerCase(),
    row.amountFiat ?? null, row.currencyFiat ?? null,
    row.amountCrypto ?? null, row.currencyCrypto ?? null,
    row.status, row.invoiceHash ?? null, now, now,
  );
}

export function listOnrampOrders(wallet: string, limit = 20): OnrampOrderRow[] {
  return db
    .prepare(
      `SELECT id, provider, external_id AS externalId, wallet_addr AS walletAddr,
              amount_fiat AS amountFiat, currency_fiat AS currencyFiat,
              amount_crypto AS amountCrypto, currency_crypto AS currencyCrypto,
              status, invoice_hash AS invoiceHash, created_at AS createdAt, updated_at AS updatedAt
       FROM onramp_orders WHERE wallet_addr = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(wallet.toLowerCase(), limit) as unknown as OnrampOrderRow[];
}

export function size(): number {
  const row = db.prepare('SELECT count(*) AS count FROM invoices').get() as { count: number };
  return Number(row.count);
}

/** Count invoices created by a merchant at or after the given unix-seconds timestamp (quota enforcement). */
export function countInvoicesSince(merchant: Address, sinceSeconds: number): number {
  const row = db
    .prepare('SELECT count(*) AS count FROM invoices WHERE lower(merchant) = lower(?) AND created_at >= ?')
    .get(merchant, sinceSeconds) as { count: number };
  return Number(row.count);
}
