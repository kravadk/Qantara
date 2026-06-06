import type { Address } from 'viem';
import { getField, parseJson, QANTARA_BACKEND_URL } from './http';
import { tokenSymbol } from './tokens';

export interface ExplorerActivityRecord {
  id: string;
  type: string;
  invoiceHash?: string;
  txHash?: string;
  merchant?: Address | null;
  payer?: Address | null;
  tokenSymbol?: string;
  amount?: string;
  status?: string;
  timestamp: number;
  source: 'backend';
}

export interface ExplorerActivityResponse {
  count: number;
  total?: number;
  activity: ExplorerActivityRecord[];
  source: 'backend';
}

export interface ExplorerMerchantRecord {
  merchant: Address;
  displayName: string | null;
  website: string | null;
  trust: {
    walletVerified: boolean;
    domainVerified: boolean;
    domain: string | null;
  };
}

export interface ExplorerMerchantsResponse {
  count: number;
  total?: number;
  merchants: ExplorerMerchantRecord[];
  source: 'backend';
}

export interface ExplorerStats {
  paidCount: number;
  activeMerchants: number;
  receiptsCount: number;
  last24hPaidCount: number;
  volume: Array<{ token: Address; paidCount: number; paidVolume: string }>;
}

export function normalizeExplorerActivityRecord(raw: unknown): ExplorerActivityRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const invoiceObject = getField<Record<string, unknown>>(value, 'invoice');
  const eventObject = getField<Record<string, unknown>>(value, 'latestEvent', 'latest_event', 'event');
  const source = invoiceObject ?? value;
  const timestampValue =
    getField<number | string>(value, 'timestamp', 'createdAt', 'created_at', 'blockTimestamp', 'block_timestamp')
    ?? getField<number | string>(eventObject ?? {}, 'createdAt', 'created_at', 'timestamp')
    ?? getField<number | string>(source, 'createdAt', 'created_at')
    ?? 0;
  const tokenValue = getField<Record<string, unknown> | string>(source, 'token', 'asset');
  const tokenObject = tokenValue && typeof tokenValue === 'object' ? tokenValue as Record<string, unknown> : null;
  const tokenAddress = getField<string>(source, 'tokenAddress', 'token_address', 'token') ?? getField<string>(tokenObject ?? {}, 'address');
  const token = getField<string>(source, 'tokenSymbol', 'token_symbol', 'symbol') ?? getField<string>(tokenObject ?? {}, 'symbol');
  const invoiceHash = getField<string>(source, 'invoiceHash', 'invoice_hash', 'hash') ?? getField<string>(value, 'invoiceHash', 'invoice_hash', 'hash');
  const eventId = getField<string>(eventObject ?? {}, 'id', 'eventId', 'event_id');
  const id = String(
    getField(value, 'id', 'eventId', 'event_id')
    ?? eventId
    ?? getField(value, 'txHash', 'tx_hash')
    ?? invoiceHash
    ?? '',
  );
  if (!id) return null;

  return {
    id,
    type: String(getField(eventObject ?? {}, 'type', 'eventType', 'event_type', 'name') ?? getField(value, 'type', 'eventType', 'event_type', 'name') ?? 'invoice.activity'),
    invoiceHash,
    txHash: getField<string>(source, 'paidTxHash', 'paid_tx_hash') ?? getField<string>(value, 'txHash', 'tx_hash') ?? getField<string>(eventObject ?? {}, 'txHash', 'tx_hash'),
    merchant: (getField<string | null>(source, 'merchant', 'merchantAddress', 'merchant_address') ?? null) as Address | null,
    payer: (getField<string | null>(source, 'payer', 'payerAddress', 'payer_address') ?? null) as Address | null,
    tokenSymbol: token ? String(token).toUpperCase() : tokenAddress ? tokenSymbol(tokenAddress) : undefined,
    amount: getField<string>(source, 'amount', 'value'),
    status: getField<string>(source, 'statusName', 'status_name', 'status', 'state'),
    timestamp: Number(timestampValue) || 0,
    source: 'backend',
  };
}

export async function getExplorerActivity(filter: { invoiceHash?: string; merchant?: Address; payer?: Address; status?: string; token?: string; limit?: number; offset?: number } = {}): Promise<ExplorerActivityResponse> {
  const params = new URLSearchParams();
  if (filter.invoiceHash) params.set('invoice_hash', filter.invoiceHash);
  if (filter.merchant) params.set('merchant', filter.merchant);
  if (filter.payer) params.set('payer', filter.payer);
  if (filter.status) params.set('status', filter.status);
  if (filter.token) params.set('token', filter.token);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const suffix = params.size > 0 ? `?${params}` : '';
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/explorer/activity${suffix}`);
  const body = await parseJson<{ count?: number; total?: number; activity?: unknown[]; events?: unknown[]; records?: unknown[] } | unknown[]>(res);
  const rawActivity = Array.isArray(body)
    ? body
    : Array.isArray(body.activity)
      ? body.activity
      : Array.isArray(body.events)
        ? body.events
        : Array.isArray(body.records)
          ? body.records
          : [];
  const activity = rawActivity.flatMap((item) => {
    const normalized = normalizeExplorerActivityRecord(item);
    return normalized ? [normalized] : [];
  });
  return {
    count: Array.isArray(body) ? activity.length : body.count ?? activity.length,
    total: Array.isArray(body) ? undefined : body.total,
    activity,
    source: 'backend',
  };
}

export async function getExplorerMerchants(filter: { limit?: number; offset?: number } = {}): Promise<ExplorerMerchantsResponse> {
  const params = new URLSearchParams();
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const suffix = params.size > 0 ? `?${params}` : '';
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/explorer/merchants${suffix}`);
  return parseJson<ExplorerMerchantsResponse>(res);
}

export async function getExplorerStats(): Promise<ExplorerStats> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/explorer/stats`);
  return parseJson<ExplorerStats>(res);
}
