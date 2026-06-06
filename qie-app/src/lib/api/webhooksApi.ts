import { operationalHeaders, parseJson, QANTARA_BACKEND_URL } from './http';

// Convenience re-exports so the webhook console can import everything from one module.
export { getWebhookSecret, rotateWebhookSecret, type WebhookSigningSecret } from './merchantApi';
export { hasMerchantAuth } from './http';

export interface WebhookDeliveryRecord {
  id: string;
  invoiceHash: `0x${string}`;
  eventType: string;
  targetUrl?: string;
  status: number;
  attempts: number;
  lastError?: string;
  nextRetryAt?: number;
  eventPayload?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export function isSuccessfulWebhookDelivery(delivery: Pick<WebhookDeliveryRecord, 'status'>): boolean {
  return delivery.status >= 200 && delivery.status < 300;
}

export function isFailedWebhookDelivery(delivery: Pick<WebhookDeliveryRecord, 'status'>): boolean {
  return !isSuccessfulWebhookDelivery(delivery);
}

export async function listWebhookDeliveries(filter: { invoiceHash?: string; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (filter.invoiceHash) params.set('invoice_hash', filter.invoiceHash);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/webhooks/deliveries?${params}`, {
    headers: operationalHeaders(),
  });
  return parseJson<{ count: number; total: number; limit: number; offset: number; deliveries: WebhookDeliveryRecord[] }>(res);
}

export async function retryWebhookDelivery(id: string) {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/webhooks/deliveries/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    headers: operationalHeaders(),
  });
  return parseJson<{ ok: boolean; delivery: WebhookDeliveryRecord }>(res);
}

export async function testWebhookDelivery(invoiceHash: string) {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/webhooks/test`, {
    method: 'POST',
    headers: operationalHeaders(),
    body: JSON.stringify({ invoice_hash: invoiceHash }),
  });
  return parseJson<{ ok: boolean; deliveries: WebhookDeliveryRecord[] }>(res);
}
