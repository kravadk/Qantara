/**
 * Outgoing webhook dispatcher with persisted delivery state.
 *
 * Headers:
 *   X-Qantara-Signature: <hex>
 *   X-Qantara-Timestamp: <unix seconds>
 *   X-Qantara-Event-Id: <uuid>
 */

import type { Server } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { sign } from './hmac.js';
import {
  appendInvoiceEvent,
  appendWebhookEvent,
  ensureMerchantWebhookSecret,
  getWebhookDelivery,
  getInvoice,
  listDueWebhookDeliveries,
  upsertWebhookDelivery,
  type Invoice,
  type WebhookDelivery,
} from './store.js';
import { optionalEnv } from './env.js';
import { logger } from './logger.js';

export type WebhookEventType =
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.expired'
  | 'invoice.cancelled'
  | 'invoice.refunded'
  | 'invoice.paused'
  | 'invoice.resumed'
  | 'message.created'
  | 'receipt.created';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  created: number;
  data: {
    invoice_hash: string;
    merchant: string;
    payer?: string | null;
    amount: string;
    token: string;
    status: number;
    tx_hash?: string;
    paid_at?: number;
    memo?: string;
    message_id?: string;
    sender_role?: string;
    sender_label?: string;
    message_preview?: string;
    receipt_hash?: string;
  };
}

function invoiceToEventData(inv: Invoice): WebhookEvent['data'] {
  return {
    invoice_hash: inv.hash,
    merchant: inv.merchant,
    payer: inv.payer,
    amount: inv.amount,
    token: inv.token,
    status: inv.status,
    tx_hash: inv.paidTxHash,
    paid_at: inv.paidAt,
    memo: inv.memo,
  };
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
// Hard cap on how long a single delivery is retried before it is marked terminal,
// independent of attempt count (belt-and-suspenders alongside MAX_ATTEMPTS).
const MAX_RETRY_WINDOW_SECONDS = Number(optionalEnv('WEBHOOK_MAX_RETRY_WINDOW_SECONDS') ?? '86400');

function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  const jitter = randomInt(Math.max(1, Math.floor(exp / 2)));
  return exp + jitter;
}

function buildWebhookEvent(
  inv: Invoice,
  type: WebhookEventType,
  extraData: Partial<WebhookEvent['data']> = {},
): WebhookEvent {
  return {
    id: `evt_${randomUUID()}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { ...invoiceToEventData(inv), ...extraData },
  };
}

async function attemptWebhookDelivery(
  inv: Invoice,
  event: WebhookEvent,
  deliveryId: string,
  attempt: number,
): Promise<WebhookDelivery> {
  if (!inv.webhookUrl) throw new Error('webhook_not_configured');

  const existingDelivery = getWebhookDelivery(deliveryId);
  const createdAt = existingDelivery?.createdAt ?? Math.floor(Date.now() / 1000);
  const windowExceeded = Math.floor(Date.now() / 1000) - createdAt >= MAX_RETRY_WINDOW_SECONDS;

  // Per-merchant signing secret: every merchant signs with a unique secret so one
  // merchant cannot forge signatures for another's endpoint. Falls back to the global
  // WEBHOOK_SECRET only when a merchant address is absent (should not happen for real invoices).
  const signingSecret = inv.merchant
    ? ensureMerchantWebhookSecret(inv.merchant).secret
    : optionalEnv('WEBHOOK_SECRET');

  if (!signingSecret) {
    appendWebhookEvent(inv.hash, {
      type: event.type,
      deliveredAt: Math.floor(Date.now() / 1000),
      status: 0,
      error: 'WEBHOOK_SECRET is required',
    });
    appendInvoiceEvent(inv.hash, 'webhook.failed', { eventType: event.type, targetUrl: inv.webhookUrl, deliveryId });
    return upsertWebhookDelivery({
      id: deliveryId,
      eventId: event.id,
      invoiceHash: inv.hash,
      eventType: event.type,
      targetUrl: inv.webhookUrl,
      status: 0,
      attempts: 0,
      lastError: 'WEBHOOK_SECRET is required',
      eventPayload: event as unknown as Record<string, unknown>,
    });
  }

  const body = JSON.stringify(event);
  const signature = sign(signingSecret, event.created, body);
  const deliveredAt = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(inv.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Qantara-Signature': signature,
        'X-Qantara-Timestamp': String(event.created),
        'X-Qantara-Event-Id': event.id,
        'X-Qantara-Delivery-Attempt': String(attempt),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const terminalClientError = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    const lastError = res.ok ? undefined : `HTTP ${res.status}`;
    const delivery = upsertWebhookDelivery({
      id: deliveryId,
      eventId: event.id,
      invoiceHash: inv.hash,
      eventType: event.type,
      targetUrl: inv.webhookUrl,
      status: res.status,
      attempts: attempt,
      lastError,
      nextRetryAt: res.ok || terminalClientError || attempt >= MAX_ATTEMPTS || windowExceeded
        ? undefined
        : Math.floor((Date.now() + backoffDelay(attempt)) / 1000),
      eventPayload: event as unknown as Record<string, unknown>,
    });
    appendWebhookEvent(inv.hash, {
      type: event.type,
      deliveredAt,
      status: res.status,
      error: lastError ? `${lastError} (attempt ${attempt}/${MAX_ATTEMPTS})` : undefined,
    });
    if (!res.ok && !delivery.nextRetryAt) {
      appendInvoiceEvent(inv.hash, 'webhook.failed', { eventType: event.type, targetUrl: inv.webhookUrl, deliveryId, status: res.status });
    }
    return delivery;
  } catch (err: any) {
    const lastError = err?.message || 'network_error';
    const delivery = upsertWebhookDelivery({
      id: deliveryId,
      eventId: event.id,
      invoiceHash: inv.hash,
      eventType: event.type,
      targetUrl: inv.webhookUrl,
      status: 0,
      attempts: attempt,
      lastError,
      nextRetryAt: attempt >= MAX_ATTEMPTS || windowExceeded ? undefined : Math.floor((Date.now() + backoffDelay(attempt)) / 1000),
      eventPayload: event as unknown as Record<string, unknown>,
    });
    appendWebhookEvent(inv.hash, {
      type: event.type,
      deliveredAt,
      status: 0,
      error: `${lastError} (attempt ${attempt}/${MAX_ATTEMPTS})`,
    });
    if (!delivery.nextRetryAt) {
      appendInvoiceEvent(inv.hash, 'webhook.failed', { eventType: event.type, targetUrl: inv.webhookUrl, deliveryId });
    }
    return delivery;
  }
}

export async function dispatchWebhook(
  inv: Invoice,
  type: WebhookEventType,
  extraData: Partial<WebhookEvent['data']> = {},
): Promise<void> {
  if (!inv.webhookUrl) return;
  const event = buildWebhookEvent(inv, type, extraData);
  await attemptWebhookDelivery(inv, event, `wh_${event.id}`, 1);
}

export async function retryWebhookDelivery(deliveryId: string): Promise<WebhookDelivery> {
  const current = getWebhookDelivery(deliveryId);
  if (!current) throw new Error('webhook_delivery_not_found');
  const inv = getInvoice(current.invoiceHash);
  if (!inv) throw new Error('invoice_not_found');
  const event = current.eventPayload as unknown as WebhookEvent | undefined;
  if (!event?.id || !event.type || !event.data) throw new Error('webhook_event_payload_missing');
  if (current.status >= 200 && current.status < 300 && !current.nextRetryAt) throw new Error('webhook_already_succeeded');
  if (current.attempts >= MAX_ATTEMPTS) throw new Error('webhook_max_attempts_reached');
  return attemptWebhookDelivery(inv, event, current.id, current.attempts + 1);
}

export async function retryDueWebhooks(limit = 25): Promise<{ processed: number; retried: WebhookDelivery[]; errors: Array<{ id: string; error: string }> }> {
  const due = listDueWebhookDeliveries(limit);
  const retried: WebhookDelivery[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  for (const delivery of due) {
    try {
      const inv = getInvoice(delivery.invoiceHash);
      const event = delivery.eventPayload as unknown as WebhookEvent | undefined;
      if (!inv) throw new Error('invoice_not_found');
      if (!event?.id || !event.type || !event.data) throw new Error('webhook_event_payload_missing');
      if (delivery.attempts >= MAX_ATTEMPTS) throw new Error('webhook_max_attempts_reached');
      retried.push(await attemptWebhookDelivery(inv, event, delivery.id, delivery.attempts + 1));
    } catch (err: any) {
      errors.push({ id: delivery.id, error: err?.message ?? 'retry_failed' });
    }
  }
  return { processed: due.length, retried, errors };
}

export function startWebhookRetryWorker(server: Server): void {
  if (optionalEnv('WEBHOOK_RETRY_DISABLED') === 'true') return;
  const intervalMs = Number(optionalEnv('WEBHOOK_RETRY_INTERVAL_MS') ?? '15000');
  const timer = setInterval(() => {
    void retryDueWebhooks().catch((err) => {
      logger.warn('webhook_retry_worker_failed', { message: err?.message ?? String(err) });
    });
  }, Math.max(5_000, intervalMs));
  timer.unref();
  server.on('close', () => clearInterval(timer));
}
