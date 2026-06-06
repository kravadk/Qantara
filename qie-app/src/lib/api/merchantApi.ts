import type { Address } from 'viem';
import { operationalHeaders, parseJson, QANTARA_BACKEND_URL } from './http';

// --- API keys ---

export interface MerchantApiKey {
  id: string;
  name: string;
  merchant?: Address;
  scopes: string[];
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export async function listApiKeys(): Promise<MerchantApiKey[]> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/api-keys`, {
    headers: operationalHeaders(),
  });
  const body = await parseJson<{ count: number; keys: MerchantApiKey[] }>(res);
  return body.keys;
}

export async function createApiKey(input: { name?: string; scopes?: string[] } = {}): Promise<{ key: MerchantApiKey; secret: string }> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/api-keys`, {
    method: 'POST',
    headers: operationalHeaders(),
    body: JSON.stringify({ name: input.name, scopes: input.scopes }),
  });
  return parseJson<{ key: MerchantApiKey; secret: string }>(res);
}

export async function revokeApiKey(id: string): Promise<MerchantApiKey> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/api-keys/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    headers: operationalHeaders(),
  });
  const body = await parseJson<{ ok: boolean; key: MerchantApiKey }>(res);
  return body.key;
}

// --- Per-merchant webhook signing secret ---

export interface WebhookSigningSecret {
  merchant: Address;
  secret: string;
  createdAt: number;
  rotatedAt: number;
}

export async function getWebhookSecret(): Promise<WebhookSigningSecret> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/webhooks/secret`, {
    headers: operationalHeaders(),
  });
  return parseJson<WebhookSigningSecret>(res);
}

export async function rotateWebhookSecret(): Promise<WebhookSigningSecret> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/webhooks/secret/rotate`, {
    method: 'POST',
    headers: operationalHeaders(),
  });
  const body = await parseJson<{ ok: boolean } & WebhookSigningSecret>(res);
  return body;
}

// --- Billing / analytics / customers ---

export interface BillingSummary {
  merchant: Address;
  total: number;
  byStatus: { created: number; paid: number; cancelled: number; refunded: number; paused: number };
  tokens: Array<{ token: Address; paidCount: number; paidVolume: string }>;
}

export async function getBillingSummary(): Promise<BillingSummary> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/billing/summary`, {
    headers: operationalHeaders(),
  });
  return parseJson<BillingSummary>(res);
}

export interface MerchantAnalytics {
  merchant: Address;
  totalInvoices: number;
  paidInvoices: number;
  conversionRate: number;
  avgTimeToPaySeconds: number | null;
  webhook: { total: number; failed: number; failureRate: number };
}

export interface MerchantCustomer {
  payer: Address;
  invoices: number;
  paid: number;
  lastActivityAt: number;
  volume: Array<{ token: Address; paidVolume: string }>;
}

export async function getMerchantCustomers(): Promise<MerchantCustomer[]> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/billing/customers`, { headers: operationalHeaders() });
  const body = await parseJson<{ count: number; customers: MerchantCustomer[] }>(res);
  return body.customers;
}

export async function getMerchantAnalytics(): Promise<MerchantAnalytics> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/billing/analytics`, { headers: operationalHeaders() });
  return parseJson<MerchantAnalytics>(res);
}

export function receiptsCsvUrl(): string {
  return `${QANTARA_BACKEND_URL}/v1/billing/receipts.csv`;
}

// --- Merchant trust profile ---

export interface MerchantTrustProfile {
  merchant: Address;
  displayName: string | null;
  website: string | null;
  listed: boolean;
  recentPaid?: number;
  recentPaidCount?: number;
  explorerUrl?: string;
  trust: {
    walletVerified: boolean;
    telegramVerified: boolean;
    telegramLinked?: boolean;
    domainVerified: boolean;
    domain: string | null;
    pass?: {
      configured: boolean;
      verified: boolean;
      status: string;
      verificationUrl: string | null;
    };
  };
}

export async function getMerchantProfile(): Promise<MerchantTrustProfile> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/merchants/me`, { headers: operationalHeaders() });
  return parseJson<MerchantTrustProfile>(res);
}

export async function updateMerchantProfile(input: { display_name?: string; website?: string; public_listed?: boolean }): Promise<MerchantTrustProfile> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/merchants/me`, {
    method: 'PUT',
    headers: operationalHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson<MerchantTrustProfile>(res);
}

export async function requestDomainChallenge(domain: string): Promise<{ domain: string; token: string; instructions: string }> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/merchants/me/domain/challenge`, {
    method: 'POST',
    headers: operationalHeaders(),
    body: JSON.stringify({ domain }),
  });
  return parseJson<{ domain: string; token: string; instructions: string }>(res);
}

export async function verifyDomain(): Promise<MerchantTrustProfile> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/merchants/me/domain/verify`, {
    method: 'POST',
    headers: operationalHeaders(),
  });
  return parseJson<MerchantTrustProfile>(res);
}

export async function getPublicMerchantProfile(address: string): Promise<MerchantTrustProfile> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/merchants/${encodeURIComponent(address)}`);
  return parseJson<MerchantTrustProfile>(res);
}
