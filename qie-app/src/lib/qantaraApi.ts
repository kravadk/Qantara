import { parseEther, type Address, type Hex } from 'viem';
import { QANTARA_ADDRESS, QANTARA_BACKEND_URL, QUSDC_ADDRESS } from './dealRoom';
import { qieMainnet } from '../config/wagmi';
import { getField, merchantActionHeaders, numberField, operationalHeaders, parseJson, sorted, stringOrNull } from './api/http';
import type { WebhookDeliveryRecord } from './api/webhooksApi';
import { InvoiceStatus, InvoiceType } from './api/base';
import type { InvoiceStatusValue, InvoiceTypeValue, QantaraInvoice } from './api/base';
export { MerchantAuthMissingError } from './api/http';
export { statusLabel, tokenSymbol, typeLabel } from './api/tokens';
export { isFailedWebhookDelivery, isSuccessfulWebhookDelivery, listWebhookDeliveries, retryWebhookDelivery, testWebhookDelivery, type WebhookDeliveryRecord } from './api/webhooksApi';

export * from './api/base';

export * from './api/railsApi';
export * from './api/qieApi';

export interface BackendHealth {
  ok: boolean;
  status: string;
  env: string;
  uptime_seconds: number;
  invoices: number;
  persistence: string;
  db: 'ok' | string;
  migrations?: { current: string; applied: Array<{ id: string; appliedAt: number }> };
  rpc: { ok?: boolean; configured?: boolean; url: string; chainId?: number; blockNumber?: number; error?: string };
  indexer?: {
    configured: boolean;
    cursors: Array<{ contractAddress: string; lastBlock: number; updatedAt: number }>;
    runtime?: { enabled: boolean; running: boolean; lastRunAt?: number; lastError?: string; intervalMs: number };
  };
  operational?: OperationalStatus;
  version: string;
}

export * from './api/receiptsApi';

export interface ChainEventRecord {
  id: string;
  contractAddress: Address;
  invoiceHash: `0x${string}`;
  eventType: string;
  txHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface SettingsStatus {
  ok: boolean;
  backend: {
    db: string;
    persistence: string;
    invoices: number;
    migrations?: { current: string; applied: Array<{ id: string; appliedAt: number }> };
  };
  rpc: BackendHealth['rpc'];
  contracts: { qantara: string | null; qusdc: string | null; registry?: DeploymentRegistryStatus };
  webhooks: {
    signingConfigured: boolean;
    recentDeliveries: WebhookDeliveryRecord[];
    dueRetries?: number;
    stats?: OperationalStatus['webhooks'];
  };
  telegram: { botTokenConfigured: boolean };
  team?: {
    mode: string;
    members: Array<{
      address: Address;
      role: string;
      source: string;
    }>;
    roles: string[];
    apiKeyScopes: string[];
    merchantWallets: Address[];
    payoutWallet: Address | null;
    notificationRouting: {
      webhook: string;
      telegram: string;
      alerts: string;
    };
    auditLog: Array<{
      id: string;
      invoiceHash: `0x${string}`;
      type: string;
      createdAt: number;
    }>;
  };
  alerts?: {
    webhookConfigured: boolean;
    minSeverity: 'warning' | 'critical' | string;
    deliveries: Array<{
      alertId: string;
      severity: 'warning' | 'critical';
      status: number;
      attempts: number;
      lastValue?: number;
      lastThreshold?: number;
      lastError?: string;
      lastSentAt?: number;
      updatedAt: number;
    }>;
  };
  security: { envApiKeyConfigured: boolean; rpcVerification: boolean; unverifiedPaymentsAllowed: boolean };
  indexer: {
    cursors: Array<{ contractAddress: string; lastBlock: number; updatedAt: number }>;
    runtime?: { enabled: boolean; running: boolean; lastRunAt?: number; lastError?: string; intervalMs: number };
  };
  operational?: OperationalStatus;
}

export interface DeploymentRegistryStatus {
  ok: boolean;
  network: 'qieMainnet';
  chainId: 1990;
  release: string;
  verifiedAt: string;
  requiredConfigured: boolean;
  contracts: Array<{
    key: string;
    label: string;
    version: string;
    role: 'core' | 'token' | 'module';
    required: boolean;
    address: string;
    envVar: string;
    configuredAddress: string | null;
    status: 'configured' | 'address_mismatch' | 'not_configured';
    verified: boolean;
    deployedAt: string;
    verifiedAt?: string;
  }>;
}

export interface OperationalStatus {
  ok: boolean;
  alerts: Array<{
    id: string;
    severity: 'warning' | 'critical';
    message: string;
    value?: number;
    threshold?: number;
  }>;
  thresholds: {
    maxIndexerLagBlocks: number;
    indexerStaleAfterSeconds: number;
    maxDueWebhookRetries: number;
    maxRpcVerificationFailures24h: number;
  };
  indexer: {
    configured: boolean;
    healthy: boolean;
    contractAddress: string | null;
    rpcBlockNumber?: number;
    cursorBlock?: number;
    lagBlocks?: number;
    cursorUpdatedAt?: number;
    cursorStaleSeconds?: number;
  };
  webhooks: {
    healthy: boolean;
    totalDeliveries: number;
    failedDeliveries: number;
    dueRetries: number;
    pendingRetries: number;
    maxAttempts: number;
    lastFailureAt?: number;
    recentFailures: WebhookDeliveryRecord[];
  };
  rpcVerification: {
    healthy: boolean;
    failures24h: number;
    recentFailures: Array<{
      id: string;
      invoiceHash: `0x${string}`;
      type: string;
      payload: Record<string, unknown>;
      createdAt: number;
    }>;
  };
}

export interface OperationalBlockerInput {
  walletConnected: boolean;
  currentChainId?: number | null;
  expectedChainId: number;
  hasMerchantAuth: boolean;
  backendHealth?: BackendHealth | null;
  backendError?: string | null;
  settingsStatus?: SettingsStatus | null;
  settingsError?: string | null;
}

export function collectOperationalBlockers(input: OperationalBlockerInput): string[] {
  const blockers: string[] = [];
  const operational = input.settingsStatus?.operational ?? input.backendHealth?.operational;

  if (!input.walletConnected) {
    blockers.push('Connect a merchant wallet');
  } else if (input.currentChainId !== undefined && input.currentChainId !== null && input.currentChainId !== input.expectedChainId) {
    blockers.push(`Switch wallet to chain ${input.expectedChainId}`);
  }

  if (!input.backendHealth?.ok) {
    blockers.push(input.backendError ? `Backend API unavailable: ${input.backendError}` : 'Backend API unavailable');
  }

  if (input.backendHealth?.rpc?.configured === false) {
    blockers.push('QIE RPC endpoint is not configured');
  } else if (input.backendHealth?.rpc && !input.backendHealth.rpc.ok) {
    blockers.push(input.backendHealth.rpc.error ? `QIE RPC unhealthy: ${input.backendHealth.rpc.error}` : 'QIE RPC unhealthy');
  }

  if (!input.hasMerchantAuth) {
    blockers.push('Sign in with a merchant wallet for merchant operations');
  }

  if (input.settingsError) {
    blockers.push(`Authenticated settings unavailable: ${input.settingsError}`);
  }

  if (input.settingsStatus?.security.unverifiedPaymentsAllowed) {
    blockers.push('Disable unverified payment acceptance');
  }

  if (input.settingsStatus?.contracts.registry && !input.settingsStatus.contracts.registry.requiredConfigured) {
    blockers.push('Configure required contract addresses');
  }

  if (operational && !operational.ok) {
    for (const alert of operational.alerts) blockers.push(alert.message);
  }

  return Array.from(new Set(blockers));
}

export interface TelegramSetupItem {
  label: string;
  value: string;
  ok: boolean;
}

export function telegramSetupItems(settingsStatus: SettingsStatus | null, hasMerchantAuthValue: boolean): TelegramSetupItem[] {
  return [
    {
      label: 'Merchant auth',
      value: hasMerchantAuthValue ? 'connected' : 'wallet sign-in required',
      ok: hasMerchantAuthValue,
    },
    {
      label: 'Bot token',
      value: settingsStatus?.telegram.botTokenConfigured ? 'configured' : hasMerchantAuthValue ? 'missing in backend' : 'waiting for authenticated status',
      ok: Boolean(settingsStatus?.telegram.botTokenConfigured),
    },
    {
      label: 'Webhook signing',
      value: settingsStatus?.webhooks.signingConfigured ? 'HMAC configured' : hasMerchantAuthValue ? 'WEBHOOK_SECRET missing' : 'waiting for authenticated status',
      ok: Boolean(settingsStatus?.webhooks.signingConfigured),
    },
    {
      label: 'Alert webhook',
      value: settingsStatus?.alerts?.webhookConfigured ? `configured at ${settingsStatus.alerts.minSeverity}` : hasMerchantAuthValue ? 'ALERT_WEBHOOK_URL missing' : 'waiting for authenticated status',
      ok: Boolean(settingsStatus?.alerts?.webhookConfigured),
    },
  ];
}


export interface PaymentIntentRecord {
  id: string;
  invoiceHash: `0x${string}`;
  merchant: Address;
  payer?: Address;
  token: Address;
  amount: string;
  deadline: number;
  nonce?: string;
  signature?: string;
  createdAt: number;
  usedAt?: number;
}


export * from './api/explorerApi';

export interface ReconciliationStatus {
  ok: boolean;
  source: 'backend';
  generatedAt?: number;
  invoices: {
    total: number;
    open: number;
    paid: number;
    cancelled: number;
    refunded: number;
    paused: number;
    expired: number;
    byStatus: Record<string, number>;
  };
  receipts: {
    total: number;
    issued: number;
    pending: number;
    missingForPaid: number;
  };
  chain: {
    indexer: {
      configured?: boolean;
      healthy?: boolean;
      cursorBlock?: number;
      rpcBlockNumber?: number;
      lagBlocks?: number;
      cursorStaleSeconds?: number;
      lastError?: string;
    };
    events: {
      total: number;
      recent: number;
    };
  };
  webhooks: {
    totalDeliveries: number;
    failedDeliveries: number;
    dueRetries: number;
    pendingRetries: number;
    maxAttempts: number;
    recentFailures: WebhookDeliveryRecord[];
  };
  rpcVerification: {
    failures24h: number;
    recentFailures: OperationalStatus['rpcVerification']['recentFailures'];
  };
}

export interface BackendNotificationRecord {
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

function normalizeWebhookDelivery(raw: unknown): WebhookDeliveryRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = String(getField(value, 'id', 'deliveryId', 'delivery_id') ?? '');
  const invoiceHash = String(getField(value, 'invoiceHash', 'invoice_hash') ?? '');
  if (!id) return null;

  return {
    id,
    invoiceHash: invoiceHash as `0x${string}`,
    eventType: String(getField(value, 'eventType', 'event_type', 'type') ?? 'webhook.delivery'),
    targetUrl: getField<string>(value, 'targetUrl', 'target_url'),
    status: numberField(getField(value, 'status'), 0),
    attempts: numberField(getField(value, 'attempts'), 0),
    lastError: getField<string>(value, 'lastError', 'last_error'),
    nextRetryAt: getField<number>(value, 'nextRetryAt', 'next_retry_at'),
    createdAt: numberField(getField(value, 'createdAt', 'created_at'), 0),
    updatedAt: numberField(getField(value, 'updatedAt', 'updated_at'), 0),
  };
}

export function normalizeReconciliationStatus(raw: unknown): ReconciliationStatus {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const invoices = getField<Record<string, unknown>>(body, 'invoices', 'invoiceStatus', 'invoice_status') ?? {};
  const rawByStatus =
    getField<Record<string, unknown>>(invoices, 'byStatus', 'by_status', 'statusCounts', 'status_counts', 'counts')
    ?? {};
  const byStatus = Object.fromEntries(
    Object.entries(rawByStatus).map(([key, value]) => [key, numberField(value)]),
  );
  const open = numberField(getField(invoices, 'open', 'created') ?? byStatus.open ?? byStatus.created ?? byStatus.Created ?? byStatus['0']);
  const paid = numberField(getField(invoices, 'paid') ?? byStatus.paid ?? byStatus.Paid ?? byStatus['1']);
  const cancelled = numberField(getField(invoices, 'cancelled', 'canceled') ?? byStatus.cancelled ?? byStatus.canceled ?? byStatus.Cancelled ?? byStatus['2']);
  const refunded = numberField(getField(invoices, 'refunded') ?? byStatus.refunded ?? byStatus.Refunded ?? byStatus['3']);
  const paused = numberField(getField(invoices, 'paused') ?? byStatus.paused ?? byStatus.Paused ?? byStatus['4']);
  const expired = numberField(getField(invoices, 'expired') ?? byStatus.expired ?? byStatus.Expired);
  const total = numberField(
    getField(invoices, 'total', 'count')
    ?? getField(body, 'invoiceCount', 'invoice_count')
    ?? Object.values(byStatus).reduce((sum, value) => sum + value, 0),
  );

  const receipts = getField<Record<string, unknown>>(body, 'receipts', 'receiptStatus', 'receipt_status') ?? {};
  const chain = getField<Record<string, unknown>>(body, 'chain', 'indexer', 'chainStatus', 'chain_status') ?? {};
  const operational = getField<Record<string, unknown>>(body, 'operational') ?? {};
  const operationalIndexer = getField<Record<string, unknown>>(operational, 'indexer') ?? {};
  const indexer = getField<Record<string, unknown>>(chain, 'indexer') ?? operationalIndexer ?? chain;
  const chainEvents = getField<Record<string, unknown>>(chain, 'events', 'chainEvents', 'chain_events') ?? {};
  const recentChainEvents = getField<unknown[]>(chainEvents, 'recent') ?? [];
  const webhooks = getField<Record<string, unknown>>(body, 'webhooks', 'webhookStatus', 'webhook_status') ?? {};
  const rpcVerification = getField<Record<string, unknown>>(body, 'rpcVerification', 'rpc_verification', 'verification') ?? {};
  const recentWebhookFailures = (
    getField<unknown[]>(webhooks, 'recentFailures', 'recent_failures', 'failures')
    ?? []
  ).flatMap((item) => {
    const delivery = normalizeWebhookDelivery(item);
    return delivery ? [delivery] : [];
  });

  return {
    ok: Boolean(getField(body, 'ok', 'healthy') ?? true),
    source: 'backend',
    generatedAt: getField<number>(body, 'generatedAt', 'generated_at', 'timestamp'),
    invoices: {
      total,
      open,
      paid,
      cancelled,
      refunded,
      paused,
      expired,
      byStatus,
    },
    receipts: {
      total: numberField(getField(receipts, 'total', 'count')),
      issued: numberField(getField(receipts, 'issued')),
      pending: numberField(getField(receipts, 'pending')),
      missingForPaid: numberField(getField(receipts, 'missingForPaid', 'missing_for_paid', 'paidWithoutReceipt', 'paid_without_receipt')),
    },
    chain: {
      indexer: {
        configured: getField<boolean>(indexer, 'configured') ?? getField<boolean>(operationalIndexer, 'configured'),
        healthy: getField<boolean>(indexer, 'healthy', 'ok') ?? getField<boolean>(operationalIndexer, 'healthy', 'ok'),
        cursorBlock: getField<number>(indexer, 'cursorBlock', 'cursor_block', 'lastBlock', 'last_block') ?? getField<number>(operationalIndexer, 'cursorBlock', 'cursor_block', 'lastBlock', 'last_block'),
        rpcBlockNumber: getField<number>(indexer, 'rpcBlockNumber', 'rpc_block_number') ?? getField<number>(operationalIndexer, 'rpcBlockNumber', 'rpc_block_number'),
        lagBlocks: getField<number>(indexer, 'lagBlocks', 'lag_blocks') ?? getField<number>(operationalIndexer, 'lagBlocks', 'lag_blocks'),
        cursorStaleSeconds: getField<number>(indexer, 'cursorStaleSeconds', 'cursor_stale_seconds') ?? getField<number>(operationalIndexer, 'cursorStaleSeconds', 'cursor_stale_seconds'),
        lastError: getField<string>(indexer, 'lastError', 'last_error'),
      },
      events: {
        total: numberField(getField(chainEvents, 'total', 'count')),
        recent: recentChainEvents.length || numberField(getField(chainEvents, 'recentCount', 'recent_count')),
      },
    },
    webhooks: {
      totalDeliveries: numberField(getField(webhooks, 'totalDeliveries', 'total_deliveries', 'total')),
      failedDeliveries: numberField(getField(webhooks, 'failedDeliveries', 'failed_deliveries', 'failed')),
      dueRetries: numberField(getField(webhooks, 'dueRetries', 'due_retries')),
      pendingRetries: numberField(getField(webhooks, 'pendingRetries', 'pending_retries')),
      maxAttempts: numberField(getField(webhooks, 'maxAttempts', 'max_attempts')),
      recentFailures: recentWebhookFailures,
    },
    rpcVerification: {
      failures24h: numberField(getField(rpcVerification, 'failures24h', 'failures_24h', 'failures')),
      recentFailures: (getField<OperationalStatus['rpcVerification']['recentFailures']>(rpcVerification, 'recentFailures', 'recent_failures') ?? []),
    },
  };
}

export function notificationOperationalGroup(type: string): 'receipt' | 'webhook' | 'message' | 'payment' | 'invoice' {
  if (type === 'receipt_created') return 'receipt';
  if (type === 'webhook_failed') return 'webhook';
  if (type === 'invoice_message') return 'message';
  if (type === 'payment_detected' || type === 'payment_received' || type === 'invoice_paid' || type === 'invoice_settled') return 'payment';
  return 'invoice';
}

export async function getAuthNonce(): Promise<string> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/auth/nonce`);
  const body = await parseJson<{ nonce: string }>(res);
  return body.nonce;
}

export function canonicalInvoiceCreateMessage(payload: {
  merchant: Address;
  amount: string;
  token: 'QIE' | 'QUSDC';
  invoiceType: InvoiceTypeValue;
  expiresAt: number;
  title?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
  hash?: `0x${string}`;
  chainTxHash?: `0x${string}`;
  nonce: string;
  signedAt: number;
}): string {
  return `Qantara invoice create\n${JSON.stringify(sorted({
    merchant: payload.merchant.toLowerCase(),
    amount: payload.amount,
    token: payload.token,
    invoiceType: payload.invoiceType,
    expiresAt: payload.expiresAt,
    title: payload.title ?? null,
    memo: payload.memo ?? null,
    metadata: payload.metadata ?? null,
    hash: payload.hash?.toLowerCase() ?? null,
    chainTxHash: payload.chainTxHash?.toLowerCase() ?? null,
    nonce: payload.nonce,
    signedAt: payload.signedAt,
  }))}`;
}

export async function createInvoice(input: {
  merchant: Address;
  amount: string;
  token?: 'QIE' | 'QUSDC';
  invoiceType?: InvoiceTypeValue;
  title?: string;
  memo?: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
  /** On-chain invoice hash (from contract computeInvoiceHash). Backend mirrors under this key. */
  hash?: `0x${string}`;
  /** Tx hash of the createInvoice contract call (for explorer linking). */
  chainTxHash?: `0x${string}`;
  /** Wallet signature over canonical invoice fields for API-keyless production creation. */
  merchantSignature?: `0x${string}`;
  merchantNonce?: string;
  signedAt?: number;
}): Promise<QantaraInvoice> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant: input.merchant,
      amount: input.amount,
      token: input.token ?? 'QIE',
      invoice_type: input.invoiceType ?? InvoiceType.Standard,
      title: input.title,
      memo: input.memo,
      expires_at: input.expiresAt ?? 0,
      metadata: input.metadata,
      hash: input.hash,
      chain_tx_hash: input.chainTxHash,
      merchant_signature: input.merchantSignature,
      merchant_nonce: input.merchantNonce,
      signed_at: input.signedAt,
    }),
  });
  return parseJson<QantaraInvoice>(res);
}

export async function getBackendHealth(): Promise<BackendHealth> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/health`);
  return parseJson<BackendHealth>(res);
}

export async function getReconciliationStatus(): Promise<ReconciliationStatus> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/reconciliation/status`);
  const body = await parseJson<unknown>(res);
  return normalizeReconciliationStatus(body);
}

export async function getInvoice(hash: string): Promise<QantaraInvoice | null> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}`);
  if (res.status === 404) return null;
  return parseJson<QantaraInvoice>(res);
}

export async function listInvoices(filter: {
  merchant?: Address;
  payer?: Address;
  status?: InvoiceStatusValue;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  if (filter.merchant) params.set('merchant', filter.merchant);
  if (filter.payer) params.set('payer', filter.payer);
  if (filter.status !== undefined) params.set('status', String(filter.status));
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices?${params}`);
  return parseJson<{ count: number; total: number; limit: number; offset: number; invoices: QantaraInvoice[] }>(res);
}

export async function verifyPayment(hash: string, payer: Address, txHash: Hex): Promise<QantaraInvoice> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payer, tx_hash: txHash }),
  });
  const body = await parseJson<{ invoice: QantaraInvoice }>(res);
  return body.invoice;
}

export async function listChainEvents(filter: { invoiceHash?: string; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (filter.invoiceHash) params.set('invoice_hash', filter.invoiceHash);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/chain/events?${params}`, {
    headers: operationalHeaders(),
  });
  return parseJson<{ count: number; total: number; limit: number; offset: number; events: ChainEventRecord[] }>(res);
}

export async function listNotifications(filter: { merchant: Address; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  params.set('merchant', filter.merchant);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/notifications?${params}`, {
    headers: operationalHeaders(),
  });
  return parseJson<{ count: number; total: number; limit: number; offset: number; notifications: BackendNotificationRecord[] }>(res);
}

export async function markNotificationRead(id: string, merchant: Address) {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: operationalHeaders(),
    body: JSON.stringify({ merchant }),
  });
  return parseJson<{ ok: boolean }>(res);
}

export async function markAllNotificationsRead(ids: string[], merchant: Address) {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/notifications/read-all`, {
    method: 'POST',
    headers: operationalHeaders(),
    body: JSON.stringify({ merchant, ids }),
  });
  return parseJson<{ ok: boolean; count: number }>(res);
}

export async function dismissNotification(id: string, merchant: Address) {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/notifications/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    headers: operationalHeaders(),
    body: JSON.stringify({ merchant }),
  });
  return parseJson<{ ok: boolean }>(res);
}

export async function getSettingsStatus(): Promise<SettingsStatus> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/settings/status`, {
    headers: operationalHeaders(),
  });
  return parseJson<SettingsStatus>(res);
}

export async function getDeploymentStatus(): Promise<DeploymentRegistryStatus> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/deployments/status`, {
    headers: operationalHeaders(),
  });
  return parseJson<DeploymentRegistryStatus>(res);
}

// Merchant account: API keys, webhook secret, billing/analytics/customers, trust profile.
export * from './api/merchantApi';

export async function createPaymentIntent(input: {
  invoiceHash: string;
  payer?: Address;
  ttlSeconds?: number;
}): Promise<PaymentIntentRecord> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/payment-intents`, {
    method: 'POST',
    headers: merchantActionHeaders(),
    body: JSON.stringify({
      invoice_hash: input.invoiceHash,
      payer: input.payer,
      ttl_seconds: input.ttlSeconds,
    }),
  });
  const body = await parseJson<{ intent: PaymentIntentRecord }>(res);
  return body.intent;
}

export async function verifyPaymentIntent(id: string) {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/payment-intents/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    headers: merchantActionHeaders(),
  });
  return parseJson<{ ok: boolean; signatureValid: boolean; expired: boolean; intent: PaymentIntentRecord }>(res);
}

export function nativePaymentValue(invoice: QantaraInvoice): bigint {
  return parseEther(invoice.amount);
}

export function toPayUrl(hash: string): string {
  return `${window.location.origin}/pay/${hash}`;
}

// Merchant browser refund/dispute/lifecycle actions live in ./api/resolutionApi.
export * from './api/resolutionApi';

export { hasMerchantAuth } from './api/http';
