/**
 * @qie/qantara-sdk - TypeScript SDK for Qantara.
 *
 * Production invoices are created on-chain first, then mirrored to the backend
 * with the confirmed createInvoice transaction hash. Backend lifecycle state is
 * updated through verification endpoints, not direct state mutation.
 */

import { encodeFunctionData, parseAbi, parseEther, parseUnits } from 'viem';
import type { Address, Hex } from 'viem';

// Live on QIE Mainnet (chain 1990).
export const ADDRESSES = {
  Qantara:            '0x27815fC2021345EB38B68D9C8F08679A4aeee030' as Address,
  QantaraMultiPay:    '0x72a5B88063E5783954c64244b75f9F8fDb3751Bb' as Address,
  QUSDC:                 '0x88aBC76fd8e3d725139Ecc6BB75582aA3f14ec2D' as Address,
  QantaraChat:           '0x76E618ecca8D97038Ec11641E16b9e16a378576A' as Address,
  QantaraSplits:         '0xBbaeF9CF47C31436505E46cF2a39636a76C7C413' as Address,
  QantaraSubscriptionV2: '0x30ACe939BD62b6a9E9aF3f5AB4287b5FB5F39c06' as Address,
  QantaraGasRelay:       '0xE027abFb3F845c6798fA247f1053Bd1B143768d2' as Address,
} as const;

export const CHAIN_ID = 1990;
export const RPC_URL = 'https://rpc1mainnet.qie.digital';
export const EXPLORER_URL = 'https://mainnet.qie.digital';

export type TokenAlias = 'QIE' | 'QUSDC' | Address;

export interface QantaraOptions {
  chain?: 'mainnet';
  apiKey?: string;
  backendUrl?: string;
  frontendUrl?: string;
}

export interface CreateInvoiceInput {
  amount: string;
  token?: TokenAlias;
  merchant?: Address;
  title?: string;
  memo?: string;
  invoiceType?: number;
  expiresAt?: number;
  successUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
  hash?: Hex;
  chainTxHash: Hex;
  merchantSignature?: Hex;
  merchantNonce?: string;
  signedAt?: number;
}

export interface BuildCreateInvoiceCallInput {
  salt: Hex;
  token?: TokenAlias;
  amount: string | bigint;
  expiresAt?: number | bigint;
  metadataHash?: Hex;
  invoiceType?: number;
}

export interface InvoiceHandle {
  hash: Hex;
  payUrl: string;
  status: 'created';
  amount: string;
  token: TokenAlias;
}

export interface PaymentIntent {
  id: string;
  invoiceHash: Hex;
  merchant: Address;
  payer?: Address;
  token: Address;
  amount: string;
  deadline: number;
  nonce: string;
  signature: string;
  createdAt: number;
  usedAt?: number;
}

export interface RedactedPaymentIntent {
  id: string;
  invoiceHash: Hex;
  merchant: Address;
  payer?: Address;
  token: Address;
  amount: string;
  deadline: number;
  createdAt: number;
  usedAt?: number;
}

export interface QantaraEvent {
  id: string;
  invoiceHash: Hex;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface QantaraEventsResponse {
  count: number;
  limit: number;
  offset: number;
  events: QantaraEvent[];
}

export interface InvoiceEventsFilter {
  guestToken?: string;
  limit?: number;
  offset?: number;
  after?: string;
}

export interface InvoiceEventListenOptions {
  guestToken?: string;
  lastEventId?: string;
  eventTypes?: readonly string[];
}

export interface QantaraNotification {
  id: string;
  merchant: Address;
  type: string;
  invoiceHash?: Hex;
  title?: string;
  body?: string;
  payload?: Record<string, unknown>;
  createdAt: number;
  readAt?: number | null;
  dismissedAt?: number | null;
}

export interface QantaraMessage {
  id: string;
  invoiceHash: Hex;
  senderRole: 'merchant' | 'payer' | 'system';
  senderAddress?: Address;
  senderLabel?: string;
  body: string;
  createdAt: number;
  readAt?: number;
}

export interface QantaraReceipt {
  id: string;
  invoiceHash: Hex;
  txHash: Hex;
  payer: Address;
  merchant: Address;
  amount: string;
  token: Address;
  issuedAt: number;
  receiptHash: Hex;
  verification?: ReceiptVerification;
}

export interface ReceiptVerification {
  source: 'backend_sqlite_rpc_verified' | string;
  policy: 'issued_after_verified_payment' | string;
  anchored: boolean;
  receiptHash?: Hex | null;
  txHash?: Hex | null;
  onChainAnchor: {
    enabled: boolean;
    configured: boolean;
    /** True only when both a registry address and an anchoring signer are configured. */
    ready?: boolean;
    registryAddress: Address | null;
    status: 'not_configured' | 'registry_configured_anchor_not_indexed' | 'anchored' | 'anchor_failed' | string;
    mode: 'backend_receipt_only' | 'optional_receipt_registry' | string;
    anchorTxHash?: Hex | null;
    anchoredAt?: number | null;
    anchorStatus?: 'pending' | 'anchored' | 'failed' | null;
  };
}

export interface ReceiptsStatusResponse {
  ok: boolean;
  source: 'sqlite' | string;
  receipts: { total: number; issued: number };
  verification: ReceiptVerification;
}

export interface ReceiptsListResponse {
  count: number;
  total: number;
  limit: number;
  offset: number;
  receipts: QantaraReceipt[];
}

export interface BuildAnchorReceiptCallInput {
  invoiceHash: Hex;
  receiptHash: Hex;
  paymentTxHash: Hex;
  merchant: Address;
  payer: Address;
  uri?: string;
}

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
    invoice_hash: Hex;
    merchant: Address;
    payer?: Address | null;
    amount: string;
    token: Address;
    status: number;
    tx_hash?: Hex;
    paid_at?: number;
    memo?: string;
    message_id?: string;
    sender_role?: string;
    sender_label?: string;
    message_preview?: string;
    receipt_hash?: Hex;
  };
}

export interface WebhookDelivery {
  id: string;
  invoiceHash: Hex;
  eventId?: string;
  eventType: WebhookEventType | string;
  targetUrl: string;
  status: number;
  attempts: number;
  lastError?: string;
  nextRetryAt?: number;
  eventPayload?: WebhookEvent | Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookDeliveriesResponse {
  count: number;
  total: number;
  limit: number;
  offset: number;
  deliveries: WebhookDelivery[];
}

export interface WebhookRetryResponse {
  ok: true;
  delivery: WebhookDelivery;
}

export interface WebhookRetryDueResponse {
  ok: true;
  processed: number;
  retried: WebhookDelivery[];
  errors: Array<{ id: string; error: string }>;
}

export interface WebhookTestResponse {
  ok: true;
  deliveries: WebhookDelivery[];
}

export interface PaymentIntentVerifyResponse {
  ok: boolean;
  signatureValid: boolean;
  expired: boolean;
  used: boolean;
  intent: RedactedPaymentIntent;
}

export interface PaymentIntentUseResponse {
  ok: true;
  intent: RedactedPaymentIntent;
}

export interface PaymentIntentsListResponse {
  count: number;
  total: number;
  limit: number;
  offset: number;
  intents: RedactedPaymentIntent[];
}

export type PaymentRailKind =
  | 'invoice'
  | 'multipay'
  | 'escrow'
  | 'recurring'
  | 'batch'
  | 'chat'
  | 'splits'
  | 'subscription'
  | 'gas_relay'
  | string;

export type PaymentRequirementScheme = 'qantara' | 'native' | 'erc20' | 'x402' | string;

export interface PaymentRequirement {
  scheme: PaymentRequirementScheme;
  network: string;
  chainId?: number;
  token?: Address | 'QIE' | 'QUSDC' | string;
  tokenSymbol?: string;
  amount?: string;
  merchant?: Address;
  invoiceHash?: Hex;
  deadline?: number;
  verifier?: string;
  facilitator?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PaymentRequirementGetOptions {
  payer?: Address;
  format?: 'qantara' | 'x402' | string;
}

export interface PaymentRequirementResponse {
  invoiceHash?: Hex;
  requirement: PaymentRequirement | null;
  source?: 'backend' | 'chain' | string;
  generatedAt?: number | string;
  expiresAt?: number;
  [key: string]: unknown;
}

export interface PaymentRouteAction {
  type: 'wallet_sendTransaction' | 'contract_write' | 'erc20_transfer' | 'erc20_approve' | 'typed_data_signature' | 'external_checkout' | string;
  label: string;
  target: Address | null;
  method?: string;
  value?: string;
  amount?: string;
  url?: string;
}

export interface PaymentRouteCandidate {
  id: string;
  rail: 'QIE' | 'QUSDC' | string;
  method: string;
  label: string;
  state: 'ready' | 'blocked' | 'settled' | 'expired' | 'unsupported' | string;
  recommended: boolean;
  reason: string;
  token: {
    symbol: 'QIE' | 'QUSDC' | string;
    address: Address | null;
    decimals: 18 | 6 | number;
  };
  settlementContract: Address | null;
  requiresNativeGas?: boolean;
  provider?: string;
  fallbackRouteIds?: string[];
  actions: PaymentRouteAction[];
  verifyEndpoint: string;
  explorer: {
    merchantUrl: string | null;
    tokenUrl: string | null;
    settlementContractUrl: string | null;
    txUrlTemplate: string;
  };
  source: 'backend_invoice_and_rail_catalog' | string;
}

export interface AcquisitionRoute {
  id: string;
  label: string;
  tokenSymbol: 'QIE' | 'QUSDC' | string;
  state: 'available' | 'disabled' | string;
  reason: string;
  actionType: 'external_link' | 'contract_mint' | string;
  url: string | null;
  requiresRealTx: true;
  source: 'qie_ecosystem_registry' | 'qusdc_vault_config' | string;
  metadata?: Record<string, string | null>;
}

export interface PaymentRoutePlan {
  invoiceHash: Hex;
  chainId: number;
  network: string;
  state: 'ready' | 'blocked' | 'settled' | 'expired' | 'unsupported' | string;
  payable: boolean;
  reason?: string;
  token: {
    symbol: 'QIE' | 'QUSDC' | 'unsupported' | string;
    address: Address;
    decimals: 18 | 6 | number | null;
  };
  amount: string;
  merchant: Address;
  payer: Address | null;
  expiresAt: number | null;
  recommendedRouteId: string | null;
  routes: PaymentRouteCandidate[];
  acquisitionRoutes: AcquisitionRoute[];
  externalActions: AcquisitionRoute[];
  requiresRealTx: true;
  dataSources: string[];
}

export interface PaymentRail {
  id: string;
  name?: string;
  kind?: PaymentRailKind;
  network?: string;
  chainId?: number;
  enabled?: boolean;
  contractAddress?: Address;
  token?: Address | 'QIE' | 'QUSDC' | string;
  tokenSymbol?: string;
  paymentRequirements?: PaymentRequirement[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RailsListResponse {
  rails: PaymentRail[];
  count?: number;
  updatedAt?: number | string;
  paymentRequirements?: PaymentRequirement[];
  [key: string]: unknown;
}

export interface QusdcCapabilityProbe {
  supported: boolean;
  status: 'ready' | 'disabled' | 'degraded' | string;
  reason: string;
  address: Address | null;
  metadata: { name: string | null; symbol: string | null; decimals: number | null };
  capabilities: {
    erc20Transfer: boolean;
    approveAndPay: boolean;
    permit: { supported: boolean; reason: string };
    eip3009: { supported: boolean; reason: string };
  };
  checkedAt: number;
  source: 'qie_rpc_contract_probe' | string;
}

export interface ExplorerActivityFilter {
  merchant?: Address;
  invoiceHash?: Hex;
  railId?: string;
  token?: Address | 'QIE' | 'QUSDC' | string;
  status?: string | number;
  type?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface ExplorerActivityItem {
  id: string;
  type: string;
  invoiceHash?: Hex;
  txHash?: Hex;
  receiptHash?: Hex;
  merchant?: Address;
  payer?: Address;
  amount?: string;
  token?: Address | 'QIE' | 'QUSDC' | string;
  tokenSymbol?: string;
  railId?: string;
  status?: string | number;
  createdAt: number | string;
  updatedAt?: number | string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ExplorerActivityResponse {
  activity: ExplorerActivityItem[];
  count?: number;
  nextCursor?: string | null;
  source?: 'backend' | 'chain' | string;
  updatedAt?: number | string;
  [key: string]: unknown;
}

export interface ExplorerMerchantRecord {
  merchant: Address;
  displayName: string | null;
  website: string | null;
  trust: {
    walletVerified?: boolean;
    domainVerified: boolean;
    domain: string | null;
  };
}

export interface ExplorerMerchantsResponse {
  merchants: ExplorerMerchantRecord[];
  count?: number;
  total?: number;
  limit?: number;
  offset?: number;
  source?: 'backend' | string;
}

export type ReconciliationCheckStatus =
  | 'ok'
  | 'warning'
  | 'error'
  | 'disabled'
  | 'unknown'
  | string;

export interface ReconciliationCheck {
  id: string;
  status: ReconciliationCheckStatus;
  label?: string;
  message?: string;
  source?: 'backend' | 'chain' | 'rpc' | 'indexer' | 'webhook' | string;
  updatedAt?: number | string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ReconciliationStatusResponse {
  ok?: boolean;
  status?: ReconciliationCheckStatus;
  source?: 'backend' | string;
  generatedAt?: number | string;
  updatedAt?: number | string;
  chain?: Record<string, unknown>;
  indexer?: Record<string, unknown>;
  invoices?: Record<string, unknown>;
  payments?: Record<string, unknown>;
  receipts?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
  alerts?: Record<string, unknown>;
  checks?: ReconciliationCheck[];
  [key: string]: unknown;
}

function tokenToAddress(t: TokenAlias = 'QIE'): Address {
  if (t === 'QIE') return '0x0000000000000000000000000000000000000000' as Address;
  if (t === 'QUSDC') return ADDRESSES.QUSDC;
  return t as Address;
}

const splitsAbi = parseAbi([
  'function createSplit(address[] recipients,uint32[] sharesBps,address controller,bytes32 salt) returns (bytes32)',
]);
const streamsAbi = parseAbi([
  'function createStream(address recipient,address token,uint256 amountPerSec,uint64 startsAt,uint64 endsAt) payable returns (uint256)',
]);
const chatAbi = parseAbi([
  'function sendMessage(address to,bytes ciphertext,bytes32 metadataHash) returns (uint64)',
]);
const qantaraAbi = parseAbi([
  'function createInvoice(bytes32 salt,address token,uint256 amount,uint64 expiresAt,bytes32 metadataHash,uint8 invoiceType) external returns (bytes32)',
  'function cancelInvoice(bytes32 invoiceHash) external',
  'function pauseInvoice(bytes32 invoiceHash) external',
  'function resumeInvoice(bytes32 invoiceHash) external',
  'function refundInvoice(bytes32 invoiceHash) external payable',
]);
const receiptRegistryAbi = parseAbi([
  'function anchorReceipt(bytes32 invoiceHash,bytes32 receiptHash,bytes32 paymentTxHash,address merchant,address payer,string uri) external returns ((bytes32 invoiceHash,bytes32 receiptHash,bytes32 paymentTxHash,address merchant,address payer,address issuer,uint64 anchoredAt,string uri))',
]);

function assertNoApiKeyQueryString(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    parsed = new URL(url, 'https://qantara.invalid');
  }
  const forbidden = new Set(['api_key', 'apikey', 'api-key', 'qantara_api_key', 'authorization', 'access_token', 'bearer']);
  for (const key of parsed.searchParams.keys()) {
    if (forbidden.has(key.toLowerCase())) {
      throw new Error(`qantara_sdk: API keys must be sent with Authorization headers, not query string parameter "${key}"`);
    }
  }
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  apiKey: string | undefined,
): Promise<T> {
  assertNoApiKeyQueryString(url);
  const headers = new Headers(init.headers);
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('content-type', 'application/json');
  const r = await fetch(url, { ...init, headers });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`qantara_sdk: ${r.status} ${r.statusText} - ${body.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

function headersWithGuestToken(guestToken?: string): Headers {
  const headers = new Headers();
  if (guestToken) headers.set('x-qantara-guest-token', guestToken);
  return headers;
}

function urlWithParams(url: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sorted((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function canonicalInvoiceCreateMessage(payload: {
  merchant: Address;
  amount: string;
  token: 'QIE' | 'QUSDC';
  invoiceType?: number;
  expiresAt?: number;
  title?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
  hash?: Hex;
  chainTxHash?: Hex;
  nonce: string;
  signedAt: number;
}): string {
  return `Qantara invoice create\n${JSON.stringify(sorted({
    merchant: payload.merchant.toLowerCase(),
    amount: payload.amount,
    token: payload.token,
    invoiceType: payload.invoiceType ?? 0,
    expiresAt: payload.expiresAt ?? 0,
    title: payload.title ?? null,
    memo: payload.memo ?? null,
    metadata: payload.metadata ?? null,
    hash: payload.hash?.toLowerCase() ?? null,
    chainTxHash: payload.chainTxHash?.toLowerCase() ?? null,
    nonce: payload.nonce,
    signedAt: payload.signedAt,
  }))}`;
}

export class Qantara {
  readonly options: Required<Omit<QantaraOptions, 'apiKey'>> & { apiKey?: string };
  readonly invoices: InvoicesApi;
  readonly splits: SplitsApi;
  readonly streams: StreamsApi;
  readonly chat: ChatApi;
  readonly onramp: OnrampApi;
  readonly webhooks: WebhooksApi;
  readonly receipts: ReceiptsApi;
  readonly chain: ChainApi;
  readonly ops: OpsApi;
  readonly notifications: NotificationsApi;
  readonly paymentIntents: PaymentIntentsApi;
  readonly rails: RailsApi;
  readonly paymentRequirements: PaymentRequirementsApi;
  readonly paymentRoutes: PaymentRoutesApi;
  readonly explorer: ExplorerApi;
  readonly reconciliation: ReconciliationApi;
  readonly flows: FlowsApi;

  constructor(opts: QantaraOptions = {}) {
    this.options = {
      chain: opts.chain ?? 'mainnet',
      backendUrl: opts.backendUrl ?? 'https://api.qantara.app',
      frontendUrl: opts.frontendUrl ?? 'https://qantara.app',
      apiKey: opts.apiKey,
    };
    this.invoices = new InvoicesApi(this);
    this.splits = new SplitsApi(this);
    this.streams = new StreamsApi(this);
    this.chat = new ChatApi(this);
    this.onramp = new OnrampApi(this);
    this.webhooks = new WebhooksApi(this);
    this.receipts = new ReceiptsApi(this);
    this.chain = new ChainApi(this);
    this.ops = new OpsApi(this);
    this.notifications = new NotificationsApi(this);
    this.paymentIntents = new PaymentIntentsApi(this);
    this.rails = new RailsApi(this);
    this.paymentRequirements = new PaymentRequirementsApi(this);
    this.paymentRoutes = new PaymentRoutesApi(this);
    this.explorer = new ExplorerApi(this);
    this.reconciliation = new ReconciliationApi(this);
    this.flows = new FlowsApi(this);
  }

  async resolveHandle(handle: string): Promise<Address | null> {
    const url = `${this.options.backendUrl}/v1/resolve?q=${encodeURIComponent(handle)}`;
    const j = await jsonRequest<{ ok: boolean; result?: { address: Address } }>(
      url,
      { method: 'GET' },
      this.options.apiKey,
    );
    return j.ok && j.result ? j.result.address : null;
  }
}

class InvoicesApi {
  constructor(private sdk: Qantara) {}

  buildCreateInvoiceCall(input: BuildCreateInvoiceCallInput) {
    const token = input.token ?? 'QIE';
    const amount = typeof input.amount === 'bigint'
      ? input.amount
      : token === 'QUSDC'
        ? parseUnits(input.amount, 6)
        : parseEther(input.amount);
    return {
      to: ADDRESSES.Qantara,
      data: encodeFunctionData({
        abi: qantaraAbi,
        functionName: 'createInvoice',
        args: [
          input.salt,
          tokenToAddress(token),
          amount,
          BigInt(input.expiresAt ?? 0),
          input.metadataHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
          input.invoiceType ?? 0,
        ],
      }),
    };
  }

  buildCancelInvoiceCall(hash: Hex) {
    return {
      to: ADDRESSES.Qantara,
      data: encodeFunctionData({
        abi: qantaraAbi,
        functionName: 'cancelInvoice',
        args: [hash],
      }),
    };
  }

  buildPauseInvoiceCall(hash: Hex) {
    return {
      to: ADDRESSES.Qantara,
      data: encodeFunctionData({
        abi: qantaraAbi,
        functionName: 'pauseInvoice',
        args: [hash],
      }),
    };
  }

  buildResumeInvoiceCall(hash: Hex) {
    return {
      to: ADDRESSES.Qantara,
      data: encodeFunctionData({
        abi: qantaraAbi,
        functionName: 'resumeInvoice',
        args: [hash],
      }),
    };
  }

  buildRefundInvoiceCall(hash: Hex, value: bigint = 0n) {
    return {
      to: ADDRESSES.Qantara,
      value,
      data: encodeFunctionData({
        abi: qantaraAbi,
        functionName: 'refundInvoice',
        args: [hash],
      }),
    };
  }

  async getCreateNonce(): Promise<string> {
    const j = await jsonRequest<{ nonce: string }>(
      `${this.sdk.options.backendUrl}/v1/auth/nonce`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
    return j.nonce;
  }

  async create(input: CreateInvoiceInput): Promise<InvoiceHandle> {
    const merchant = input.merchant;
    if (!merchant) throw new Error('qantara_sdk: merchant is required');
    if (!input.chainTxHash) throw new Error('qantara_sdk: chainTxHash is required for production invoice creation');
    const body = {
      amount: input.amount,
      token: input.token === 'QUSDC' ? 'QUSDC' : 'QIE',
      merchant,
      title: input.title,
      memo: input.memo,
      invoice_type: input.invoiceType ?? 0,
      expires_at: input.expiresAt,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      webhook_url: input.webhookUrl,
      metadata: input.metadata,
      hash: input.hash,
      chain_tx_hash: input.chainTxHash,
      merchant_signature: input.merchantSignature,
      merchant_nonce: input.merchantNonce,
      signed_at: input.signedAt,
    };
    const j = await jsonRequest<{ hash: Hex; url?: string; status?: string }>(
      `${this.sdk.options.backendUrl}/v1/invoices`,
      { method: 'POST', body: JSON.stringify(body) },
      this.sdk.options.apiKey,
    );
    return {
      hash: j.hash,
      payUrl: j.url ?? `${this.sdk.options.frontendUrl.replace(/\/$/, '')}/pay/${j.hash}`,
      status: 'created',
      amount: input.amount,
      token: input.token ?? 'QIE',
    };
  }

  async get(hash: Hex) {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/invoices/${hash}`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async list(filter: { merchant?: Address; payer?: Address; status?: number; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (filter.merchant) params.set('merchant', filter.merchant);
    if (filter.payer) params.set('payer', filter.payer);
    if (filter.status !== undefined) params.set('status', String(filter.status));
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/invoices`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async createPaymentIntent(hash: Hex, input: { payer?: Address; ttlSeconds?: number } = {}): Promise<PaymentIntent> {
    return this.sdk.paymentIntents.create({ invoiceHash: hash, ...input });
  }

  private async merchantAction(hash: Hex, action: string, body: Record<string, unknown> = {}) {
    const j = await jsonRequest<{ ok: boolean; invoice: unknown }>(
      `${this.sdk.options.backendUrl}/v1/invoices/${hash}/${action}`,
      { method: 'POST', body: JSON.stringify(body) },
      this.sdk.options.apiKey,
    );
    return j.invoice;
  }

  verifyCancel(hash: Hex, txHash: Hex) {
    return this.merchantAction(hash, 'cancel/verify', { tx_hash: txHash });
  }

  verifyPause(hash: Hex, txHash: Hex) {
    return this.merchantAction(hash, 'pause/verify', { tx_hash: txHash });
  }

  verifyResume(hash: Hex, txHash: Hex) {
    return this.merchantAction(hash, 'resume/verify', { tx_hash: txHash });
  }

  requestRefund(hash: Hex, reason?: string) {
    return this.merchantAction(hash, 'refund', reason ? { reason } : {});
  }

  verifyRefund(hash: Hex, txHash: Hex) {
    return this.merchantAction(hash, 'refund/verify', { tx_hash: txHash });
  }

  verifyContractRefund(hash: Hex, txHash: Hex) {
    return this.merchantAction(hash, 'refund/verify-contract', { tx_hash: txHash });
  }

  async verifyPayment(hash: Hex, input: { payer: Address; txHash: Hex }) {
    const j = await jsonRequest<{ ok: boolean; invoice: unknown }>(
      `${this.sdk.options.backendUrl}/v1/invoices/${hash}/verify-payment`,
      { method: 'POST', body: JSON.stringify({ payer: input.payer, tx_hash: input.txHash }) },
      undefined,
    );
    return j.invoice;
  }

  async events(hash: Hex, filter: InvoiceEventsFilter = {}): Promise<QantaraEventsResponse> {
    const params = new URLSearchParams();
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    if (filter.after) params.set('after', filter.after);
    return jsonRequest<QantaraEventsResponse>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/invoices/${hash}/events`, params),
      { method: 'GET', headers: headersWithGuestToken(filter.guestToken) },
      this.sdk.options.apiKey,
    );
  }

  listenInvoiceEvents(hash: Hex, onEvent: (event: QantaraEvent) => void, options: InvoiceEventListenOptions = {}) {
    const params = new URLSearchParams();
    if (options.guestToken) params.set('guest_token', options.guestToken);
    if (options.lastEventId) params.set('after', options.lastEventId);
    const url = urlWithParams(`${this.sdk.options.backendUrl}/v1/invoices/${hash}/events`, params);
    assertNoApiKeyQueryString(url);
    const source = new EventSource(url);
    source.onmessage = (event) => onEvent(JSON.parse(event.data) as QantaraEvent);
    const eventTypes = options.eventTypes ?? ['invoice.created', 'invoice.viewed', 'message.created', 'payment.detected', 'payment_intent.used', 'invoice.paid', 'invoice.settled', 'invoice.refunded', 'receipt.created'];
    for (const type of eventTypes) {
      source.addEventListener(type, (event) => onEvent(JSON.parse((event as MessageEvent).data) as QantaraEvent));
    }
    return () => source.close();
  }
}

/** Minimal read-only shape of a backend invoice record used by high-level flows. */
export interface InvoiceLike {
  hash?: Hex;
  status?: number;
  payer?: Address | null;
  paidTxHash?: string | null;
  paidAt?: number | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ProofChainStep {
  key: 'create_tx' | 'payment_tx' | 'indexed_event' | 'rpc_verification' | 'receipt' | 'webhook' | 'onchain_anchor';
  label: string;
  status: 'confirmed' | 'pending' | 'missing';
  detail?: string;
}

export interface ProofChain {
  invoiceHash: Hex;
  paid: boolean;
  steps: ProofChainStep[];
  invoice: InvoiceLike | null;
  receipt: QantaraReceipt | null;
  events: QantaraEvent[];
  webhooks: WebhookDelivery[];
}

export interface PaymentPlan {
  invoiceHash: Hex;
  invoice: InvoiceLike | null;
  routes: PaymentRoutePlan | null;
  requirements: PaymentRequirementResponse | null;
}

export interface AwaitPaymentOptions {
  pollMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * High-level orchestration over the per-endpoint clients. These helpers never
 * synthesize paid state — they only aggregate what the backend already reports
 * (invoice record, indexed events, issued receipt, webhook deliveries, anchor).
 */
class FlowsApi {
  constructor(private sdk: Qantara) {}

  /**
   * Aggregate the full payment proof chain for one invoice into ordered steps:
   * create tx, payment tx, indexed event, RPC verification, receipt, webhook,
   * and optional on-chain anchor. Each sub-read is best-effort so a missing scope
   * degrades a single step rather than failing the whole call.
   */
  async verifyPaymentChain(hash: Hex, options: { guestToken?: string } = {}): Promise<ProofChain> {
    const invoice = (await this.sdk.invoices.get(hash).catch(() => null)) as InvoiceLike | null;
    const eventsResp = await this.sdk.invoices
      .events(hash, options.guestToken ? { guestToken: options.guestToken } : {})
      .catch(() => null);
    const events = Array.isArray(eventsResp?.events) ? eventsResp.events : [];
    const receipt = await this.sdk.receipts.get(hash).catch(() => null);
    const webhooksResp = await this.sdk.webhooks.deliveries({ invoiceHash: hash }).catch(() => null);
    const webhooks = Array.isArray(webhooksResp?.deliveries) ? webhooksResp.deliveries : [];

    const paid = invoice?.status === 1 || Boolean(invoice?.paidAt) || Boolean(receipt);
    const createTxRaw = invoice?.metadata?.['chain_tx_hash'];
    const createTx = typeof createTxRaw === 'string' ? createTxRaw : undefined;
    const paymentTx = invoice?.paidTxHash ?? receipt?.txHash ?? undefined;
    const indexedEvent = events.find((e) => e.type === 'invoice.paid' || e.type === 'invoice.settled');
    const deliveredWebhook = webhooks.find((w) => w.status >= 200 && w.status < 300);
    const anchor = receipt?.verification?.onChainAnchor;
    const anchored = receipt?.verification?.anchored ?? false;

    const steps: ProofChainStep[] = [
      { key: 'create_tx', label: 'Invoice create transaction', status: createTx ? 'confirmed' : 'missing', detail: createTx },
      { key: 'payment_tx', label: 'Payment transaction', status: paymentTx ? 'confirmed' : 'missing', detail: paymentTx ?? undefined },
      {
        key: 'indexed_event',
        label: 'Indexed payment event',
        status: indexedEvent ? 'confirmed' : paid ? 'pending' : 'missing',
        detail: indexedEvent?.type,
      },
      { key: 'rpc_verification', label: 'Backend RPC verification', status: paid ? 'confirmed' : 'missing' },
      { key: 'receipt', label: 'Receipt issued', status: receipt ? 'confirmed' : 'missing', detail: receipt?.receiptHash },
      {
        key: 'webhook',
        label: 'Merchant webhook delivery',
        status: deliveredWebhook ? 'confirmed' : webhooks.length ? 'pending' : 'missing',
      },
      {
        key: 'onchain_anchor',
        label: 'On-chain receipt anchor',
        status: anchored ? 'confirmed' : anchor?.ready ? 'pending' : 'missing',
        detail: anchor?.anchorTxHash ?? undefined,
      },
    ];

    return { invoiceHash: hash, paid, steps, invoice, receipt, events, webhooks };
  }

  /** Combine invoice state, route candidates, and payment requirements into one plan. */
  async preparePayment(hash: Hex): Promise<PaymentPlan> {
    const invoice = (await this.sdk.invoices.get(hash).catch(() => null)) as InvoiceLike | null;
    const routes = await this.sdk.paymentRoutes.get(hash).catch(() => null);
    const requirements = await this.sdk.paymentRequirements.get(hash).catch(() => null);
    return { invoiceHash: hash, invoice, routes, requirements };
  }

  /**
   * Poll the backend invoice record until it reports a verified paid state or the
   * timeout elapses. Returns the latest invoice plus the issued receipt when paid.
   * Never marks paid itself — it only reads backend-verified state.
   */
  async awaitPayment(hash: Hex, options: AwaitPaymentOptions = {}): Promise<{ invoice: InvoiceLike | null; receipt: QantaraReceipt | null }> {
    const pollMs = Math.max(1000, options.pollMs ?? 4000);
    const timeoutMs = Math.max(pollMs, options.timeoutMs ?? 180_000);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (options.signal?.aborted) throw new Error('qantara_sdk: await_payment_aborted');
      const invoice = (await this.sdk.invoices.get(hash).catch(() => null)) as InvoiceLike | null;
      const paid = invoice?.status === 1 || Boolean(invoice?.paidAt);
      if (paid) {
        const receipt = await this.sdk.receipts.get(hash).catch(() => null);
        return { invoice, receipt };
      }
      if (Date.now() >= deadline) return { invoice, receipt: null };
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

class SplitsApi {
  constructor(private sdk: Qantara) {}
  buildCreateCall(recipients: Address[], sharesBps: number[], controller: Address, salt: Hex) {
    if (recipients.length !== sharesBps.length) throw new Error('qantara_sdk: shape_mismatch');
    if (sharesBps.reduce((a, b) => a + b, 0) !== 10000) throw new Error('qantara_sdk: bps_must_sum_10000');
    return {
      to: ADDRESSES.QantaraSplits,
      data: encodeFunctionData({
        abi: splitsAbi,
        functionName: 'createSplit',
        args: [recipients, sharesBps, controller, salt],
      }),
    };
  }
}

class StreamsApi {
  constructor(private sdk: Qantara) {}
  buildCreateNativeStreamCall(recipient: Address, amountPerSec: bigint, startsAt: number, endsAt: number) {
    const total = amountPerSec * BigInt(endsAt - startsAt);
    return {
      to: ADDRESSES.QantaraSubscriptionV2,
      value: total,
      data: encodeFunctionData({
        abi: streamsAbi,
        functionName: 'createStream',
        args: [recipient, '0x0000000000000000000000000000000000000000', amountPerSec, BigInt(startsAt), BigInt(endsAt)],
      }),
    };
  }
}

class ChatApi {
  constructor(private sdk: Qantara) {}

  async messages(hash: Hex, filter: { guestToken?: string; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest<{ count: number; total: number; limit: number; offset: number; messages: QantaraMessage[] }>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/invoices/${hash}/messages`, params),
      { method: 'GET', headers: headersWithGuestToken(filter.guestToken) },
      this.sdk.options.apiKey,
    );
  }

  async sendMessage(
    hash: Hex,
    input: {
      senderRole: QantaraMessage['senderRole'];
      body: string;
      senderAddress?: Address;
      senderLabel?: string;
      guestToken?: string;
    },
  ) {
    return jsonRequest<{ ok: boolean; message: QantaraMessage; guest_token?: string }>(
      `${this.sdk.options.backendUrl}/v1/invoices/${hash}/messages`,
      {
        method: 'POST',
        headers: headersWithGuestToken(input.guestToken),
        body: JSON.stringify({
          sender_role: input.senderRole,
          sender_address: input.senderAddress,
          sender_label: input.senderLabel,
          body: input.body,
        }),
      },
      this.sdk.options.apiKey,
    );
  }

  async markMessageRead(hash: Hex, id: string, options: { guestToken?: string } = {}) {
    return jsonRequest<{ ok: boolean; message: QantaraMessage }>(
      `${this.sdk.options.backendUrl}/v1/invoices/${hash}/messages/${encodeURIComponent(id)}/read`,
      { method: 'POST', headers: headersWithGuestToken(options.guestToken) },
      this.sdk.options.apiKey,
    );
  }

  buildSendMessageCall(to: Address, ciphertext: Hex, metadataHash: Hex) {
    return {
      to: ADDRESSES.QantaraChat,
      data: encodeFunctionData({
        abi: chatAbi,
        functionName: 'sendMessage',
        args: [to, ciphertext, metadataHash],
      }),
    };
  }
}

class OnrampApi {
  constructor(private sdk: Qantara) {}
  async list(wallet: Address) {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/onramp/orders?wallet=${wallet}`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }
}

class RailsApi {
  constructor(private sdk: Qantara) {}

  async list(): Promise<RailsListResponse> {
    return jsonRequest<RailsListResponse>(
      `${this.sdk.options.backendUrl}/v1/rails`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async qusdcCapabilities(): Promise<QusdcCapabilityProbe> {
    return jsonRequest<QusdcCapabilityProbe>(
      `${this.sdk.options.backendUrl}/v1/rails/qusdc/capabilities`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }
}

class PaymentRequirementsApi {
  constructor(private sdk: Qantara) {}

  async get(invoiceHash: Hex, options: PaymentRequirementGetOptions = {}): Promise<PaymentRequirementResponse> {
    const params = new URLSearchParams();
    if (options.payer) params.set('payer', options.payer);
    if (options.format) params.set('format', options.format);
    return jsonRequest<PaymentRequirementResponse>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/payment-requirements/${invoiceHash}`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }
}

class PaymentRoutesApi {
  constructor(private sdk: Qantara) {}

  async get(invoiceHash: Hex): Promise<PaymentRoutePlan> {
    return jsonRequest<PaymentRoutePlan>(
      `${this.sdk.options.backendUrl}/v1/payment-routes/${invoiceHash}`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }
}

class ExplorerApi {
  constructor(private sdk: Qantara) {}

  async activity(filter: ExplorerActivityFilter = {}): Promise<ExplorerActivityResponse> {
    const params = new URLSearchParams();
    if (filter.merchant) params.set('merchant', filter.merchant);
    if (filter.invoiceHash) params.set('invoice_hash', filter.invoiceHash);
    if (filter.railId) params.set('rail_id', filter.railId);
    if (filter.token) params.set('token', filter.token);
    if (filter.status !== undefined) params.set('status', String(filter.status));
    if (filter.type) params.set('type', filter.type);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    if (filter.cursor) params.set('cursor', filter.cursor);
    return jsonRequest<ExplorerActivityResponse>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/explorer/activity`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async merchants(filter: { limit?: number; offset?: number } = {}): Promise<ExplorerMerchantsResponse> {
    const params = new URLSearchParams();
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest<ExplorerMerchantsResponse>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/explorer/merchants`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }
}

class ReconciliationApi {
  constructor(private sdk: Qantara) {}

  async status(): Promise<ReconciliationStatusResponse> {
    return jsonRequest<ReconciliationStatusResponse>(
      `${this.sdk.options.backendUrl}/v1/reconciliation/status`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }
}

class WebhooksApi {
  constructor(private sdk: Qantara) {}

  async verifyWebhook(input: { body: string; timestamp: string; signature: string; secret: string }): Promise<boolean> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(input.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signed = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${input.timestamp}.${input.body}`),
    );
    const expected = Array.from(new Uint8Array(signed)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return expected === input.signature;
  }

  async deliveries(filter: { invoiceHash?: Hex; limit?: number; offset?: number } = {}): Promise<WebhookDeliveriesResponse> {
    const params = new URLSearchParams();
    if (filter.invoiceHash) params.set('invoice_hash', filter.invoiceHash);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest<WebhookDeliveriesResponse>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/webhooks/deliveries`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async retryDelivery(id: string): Promise<WebhookRetryResponse> {
    return jsonRequest<WebhookRetryResponse>(
      `${this.sdk.options.backendUrl}/v1/webhooks/deliveries/${encodeURIComponent(id)}/retry`,
      { method: 'POST' },
      this.sdk.options.apiKey,
    );
  }

  async retryDue(limit = 25): Promise<WebhookRetryDueResponse> {
    return jsonRequest<WebhookRetryDueResponse>(
      `${this.sdk.options.backendUrl}/v1/webhooks/retry-due`,
      { method: 'POST', body: JSON.stringify({ limit }) },
      this.sdk.options.apiKey,
    );
  }

  async test(invoiceHash: Hex): Promise<WebhookTestResponse> {
    return jsonRequest<WebhookTestResponse>(
      `${this.sdk.options.backendUrl}/v1/webhooks/test`,
      { method: 'POST', body: JSON.stringify({ invoice_hash: invoiceHash }) },
      this.sdk.options.apiKey,
    );
  }
}

class ReceiptsApi {
  constructor(private sdk: Qantara) {}

  buildAnchorReceiptCall(registryAddress: Address, input: BuildAnchorReceiptCallInput) {
    return {
      to: registryAddress,
      data: encodeFunctionData({
        abi: receiptRegistryAbi,
        functionName: 'anchorReceipt',
        args: [
          input.invoiceHash,
          input.receiptHash,
          input.paymentTxHash,
          input.merchant,
          input.payer,
          input.uri ?? '',
        ],
      }),
    };
  }

  async status(): Promise<ReceiptsStatusResponse> {
    return jsonRequest<ReceiptsStatusResponse>(
      `${this.sdk.options.backendUrl}/v1/receipts/status`,
      { method: 'GET' },
      undefined,
    );
  }

  async get(hash: Hex): Promise<QantaraReceipt> {
    return jsonRequest<QantaraReceipt>(
      `${this.sdk.options.backendUrl}/v1/receipts/${hash}`,
      { method: 'GET' },
      undefined,
    );
  }

  async list(filter: { merchant?: Address; limit?: number; offset?: number } = {}): Promise<ReceiptsListResponse> {
    const params = new URLSearchParams();
    if (filter.merchant) params.set('merchant', filter.merchant);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest<ReceiptsListResponse>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/receipts`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }
}

class ChainApi {
  constructor(private sdk: Qantara) {}

  async events(filter: { invoiceHash?: Hex; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (filter.invoiceHash) params.set('invoice_hash', filter.invoiceHash);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/chain/events`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async status() {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/chain/status`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async sync(input: { contractAddress?: Address; fromBlock?: number; toBlock?: number } = {}) {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/chain/sync`,
      {
        method: 'POST',
        body: JSON.stringify({
          contract_address: input.contractAddress,
          from_block: input.fromBlock,
          to_block: input.toBlock,
        }),
      },
      this.sdk.options.apiKey,
    );
  }
}

class OpsApi {
  constructor(private sdk: Qantara) {}

  async health() {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/health`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async settingsStatus() {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/settings/status`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async deploymentStatus() {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/deployments/status`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async metricsText(): Promise<string> {
    const url = `${this.sdk.options.backendUrl}/v1/metrics`;
    assertNoApiKeyQueryString(url);
    const r = await fetch(url, {
      headers: this.sdk.options.apiKey ? { Authorization: `Bearer ${this.sdk.options.apiKey}` } : undefined,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`qantara_sdk: ${r.status} ${r.statusText} - ${body.slice(0, 200)}`);
    }
    return r.text();
  }

  async alertDeliveries() {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/alerts/deliveries`,
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async dispatchAlerts() {
    return jsonRequest(
      `${this.sdk.options.backendUrl}/v1/alerts/dispatch`,
      { method: 'POST' },
      this.sdk.options.apiKey,
    );
  }
}

class NotificationsApi {
  constructor(private sdk: Qantara) {}

  async list(filter: { merchant: Address; limit?: number; offset?: number }) {
    const params = new URLSearchParams({ merchant: filter.merchant });
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest<{ count: number; total: number; notifications: QantaraNotification[] }>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/notifications`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async markRead(id: string, merchant: Address) {
    return jsonRequest<{ ok: boolean }>(
      `${this.sdk.options.backendUrl}/v1/notifications/${encodeURIComponent(id)}/read`,
      { method: 'POST', body: JSON.stringify({ merchant }) },
      this.sdk.options.apiKey,
    );
  }

  async markAllRead(merchant: Address, ids: string[]) {
    return jsonRequest<{ ok: boolean; count: number }>(
      `${this.sdk.options.backendUrl}/v1/notifications/read-all`,
      { method: 'POST', body: JSON.stringify({ merchant, ids }) },
      this.sdk.options.apiKey,
    );
  }

  async dismiss(id: string, merchant: Address) {
    return jsonRequest<{ ok: boolean }>(
      `${this.sdk.options.backendUrl}/v1/notifications/${encodeURIComponent(id)}/dismiss`,
      { method: 'POST', body: JSON.stringify({ merchant }) },
      this.sdk.options.apiKey,
    );
  }
}

class PaymentIntentsApi {
  constructor(private sdk: Qantara) {}

  async create(input: { invoiceHash: Hex; payer?: Address; ttlSeconds?: number }): Promise<PaymentIntent> {
    const j = await jsonRequest<{ intent: PaymentIntent }>(
      `${this.sdk.options.backendUrl}/v1/payment-intents`,
      {
        method: 'POST',
        body: JSON.stringify({
          invoice_hash: input.invoiceHash,
          payer: input.payer,
          ttl_seconds: input.ttlSeconds,
        }),
      },
      this.sdk.options.apiKey,
    );
    return j.intent;
  }

  async list(filter: { invoiceHash?: Hex; limit?: number; offset?: number } = {}): Promise<PaymentIntentsListResponse> {
    const params = new URLSearchParams();
    if (filter.invoiceHash) params.set('invoice_hash', filter.invoiceHash);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    return jsonRequest<PaymentIntentsListResponse>(
      urlWithParams(`${this.sdk.options.backendUrl}/v1/payment-intents`, params),
      { method: 'GET' },
      this.sdk.options.apiKey,
    );
  }

  async verify(id: string): Promise<PaymentIntentVerifyResponse> {
    return jsonRequest<PaymentIntentVerifyResponse>(
      `${this.sdk.options.backendUrl}/v1/payment-intents/${encodeURIComponent(id)}/verify`,
      { method: 'POST' },
      this.sdk.options.apiKey,
    );
  }

  async use(id: string): Promise<PaymentIntentUseResponse> {
    return jsonRequest<PaymentIntentUseResponse>(
      `${this.sdk.options.backendUrl}/v1/payment-intents/${encodeURIComponent(id)}/use`,
      { method: 'POST' },
      this.sdk.options.apiKey,
    );
  }
}

// ---------------------------------------------------------------------------
// Qantara Payment Link standard (qantara://pay?...)
//
// A portable, wallet-agnostic payment request format so ANY app can generate
// Qantara-compatible links. Canonical scheme:
//
//   qantara://pay?v=1&to=0x..&chain=1990&token=0x..&amount=1.5&hash=0x..
//                 &label=Acme&message=Order%201001&expiry=1750000000
//                 &sig=<hex>&sigAlg=hmac-sha256
//
// - `to`     merchant / recipient address (required)
// - `chain`  EVM chain id (default 1990 = QIE Mainnet)
// - `token`  ERC-20 address; omitted / zero => native QIE
// - `amount` decimal string; omitted => payer-chosen amount
// - `hash`   on-chain invoice hash (optional; binds the link to an invoice)
// - `expiry` unix seconds after which the link must be rejected
// - `sig`    optional signature over canonicalQantaraLinkPayload() (merchant verification)
// ---------------------------------------------------------------------------

export const QANTARA_LINK_SCHEME = 'qantara';
export const QANTARA_LINK_ACTION = 'pay';
export const QANTARA_LINK_VERSION = '1';
export const QANTARA_DEFAULT_CHAIN_ID = 1990;

const QLINK_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const QLINK_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const QLINK_DECIMAL_RE = /^\d+(\.\d+)?$/;
const QLINK_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface QantaraPaymentLink {
  /** Merchant / recipient address. */
  to: string;
  /** EVM chain id. Defaults to QIE Mainnet (1990). */
  chainId?: number;
  /** ERC-20 token address. Omit or zero address for native QIE. */
  token?: string;
  /** Decimal amount string (e.g. "1.5"). Omit for a payer-chosen amount. */
  amount?: string;
  /** Token decimals (used for EIP-681 conversion). Default 18. */
  decimals?: number;
  /** On-chain invoice hash this link settles, if any. */
  invoiceHash?: string;
  /** Human label (merchant / store name). */
  label?: string;
  /** Free-text memo / order reference. */
  message?: string;
  /** Unix seconds after which the link is no longer valid. */
  expiry?: number;
  /** Optional signature over the canonical payload (merchant verification). */
  signature?: string;
  /** Signature algorithm identifier (e.g. "hmac-sha256"). */
  signatureAlg?: string;
}

export class QantaraLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QantaraLinkError';
  }
}

function qlinkNormalizeAddress(value: string, field: string): string {
  if (!QLINK_ADDRESS_RE.test(value)) throw new QantaraLinkError(`${field} must be a 0x-prefixed 20-byte address`);
  return value.toLowerCase();
}

/**
 * Canonical string signed/verified for a link. Stable key order, excludes the
 * signature fields. Sign this with the merchant secret and attach as `sig`.
 */
export function canonicalQantaraLinkPayload(link: QantaraPaymentLink): string {
  const parts: string[] = [
    `v=${QANTARA_LINK_VERSION}`,
    `to=${qlinkNormalizeAddress(link.to, 'to')}`,
    `chain=${link.chainId ?? QANTARA_DEFAULT_CHAIN_ID}`,
  ];
  if (link.token && link.token !== QLINK_ZERO_ADDRESS) parts.push(`token=${qlinkNormalizeAddress(link.token, 'token')}`);
  if (link.amount !== undefined) parts.push(`amount=${link.amount}`);
  if (link.invoiceHash) parts.push(`hash=${link.invoiceHash.toLowerCase()}`);
  if (link.expiry !== undefined) parts.push(`expiry=${link.expiry}`);
  return parts.join('&');
}

/** Build a canonical `qantara://pay?...` link. Throws on invalid inputs. */
export function buildQantaraLink(link: QantaraPaymentLink): string {
  const params = new URLSearchParams();
  params.set('v', QANTARA_LINK_VERSION);
  params.set('to', qlinkNormalizeAddress(link.to, 'to'));
  params.set('chain', String(link.chainId ?? QANTARA_DEFAULT_CHAIN_ID));
  if (link.token && link.token !== QLINK_ZERO_ADDRESS) params.set('token', qlinkNormalizeAddress(link.token, 'token'));
  if (link.amount !== undefined) {
    if (!QLINK_DECIMAL_RE.test(link.amount)) throw new QantaraLinkError('amount must be a decimal string');
    params.set('amount', link.amount);
  }
  if (link.decimals !== undefined) params.set('decimals', String(link.decimals));
  if (link.invoiceHash) {
    if (!QLINK_HASH_RE.test(link.invoiceHash)) throw new QantaraLinkError('invoiceHash must be a 0x-prefixed 32-byte hash');
    params.set('hash', link.invoiceHash.toLowerCase());
  }
  if (link.label) params.set('label', link.label);
  if (link.message) params.set('message', link.message);
  if (link.expiry !== undefined) {
    if (!Number.isInteger(link.expiry) || link.expiry < 0) throw new QantaraLinkError('expiry must be a unix-seconds integer');
    params.set('expiry', String(link.expiry));
  }
  if (link.signature) {
    params.set('sig', link.signature);
    params.set('sigAlg', link.signatureAlg ?? 'hmac-sha256');
  }
  return `${QANTARA_LINK_SCHEME}://${QANTARA_LINK_ACTION}?${params.toString()}`;
}

export function isQantaraLink(input: string): boolean {
  return typeof input === 'string' && input.trim().toLowerCase().startsWith(`${QANTARA_LINK_SCHEME}://`);
}

/** Parse and validate a `qantara://pay?...` link. Throws QantaraLinkError on invalid. */
export function parseQantaraLink(input: string): QantaraPaymentLink {
  if (!isQantaraLink(input)) throw new QantaraLinkError(`not a ${QANTARA_LINK_SCHEME}:// link`);
  const queryIndex = input.indexOf('?');
  if (queryIndex < 0) throw new QantaraLinkError('link has no query parameters');
  const action = input.slice(`${QANTARA_LINK_SCHEME}://`.length, queryIndex).replace(/\/+$/, '').toLowerCase();
  if (action !== QANTARA_LINK_ACTION) throw new QantaraLinkError(`unsupported action "${action}", expected "${QANTARA_LINK_ACTION}"`);
  const params = new URLSearchParams(input.slice(queryIndex + 1));

  const to = params.get('to');
  if (!to) throw new QantaraLinkError('missing required "to"');
  const link: QantaraPaymentLink = { to: qlinkNormalizeAddress(to, 'to') };

  const chain = params.get('chain');
  link.chainId = chain ? Number(chain) : QANTARA_DEFAULT_CHAIN_ID;
  if (!Number.isInteger(link.chainId) || link.chainId <= 0) throw new QantaraLinkError('chain must be a positive integer');

  const token = params.get('token');
  if (token && token !== QLINK_ZERO_ADDRESS) link.token = qlinkNormalizeAddress(token, 'token');

  const amount = params.get('amount');
  if (amount !== null) {
    if (!QLINK_DECIMAL_RE.test(amount)) throw new QantaraLinkError('amount must be a decimal string');
    link.amount = amount;
  }

  const decimals = params.get('decimals');
  if (decimals !== null) {
    link.decimals = Number(decimals);
    if (!Number.isInteger(link.decimals) || link.decimals < 0 || link.decimals > 36) {
      throw new QantaraLinkError('decimals must be an integer in [0, 36]');
    }
  }

  const hash = params.get('hash');
  if (hash) {
    if (!QLINK_HASH_RE.test(hash)) throw new QantaraLinkError('hash must be a 0x-prefixed 32-byte hash');
    link.invoiceHash = hash.toLowerCase();
  }

  const label = params.get('label');
  if (label) link.label = label;
  const message = params.get('message');
  if (message) link.message = message;

  const expiry = params.get('expiry');
  if (expiry !== null) {
    link.expiry = Number(expiry);
    if (!Number.isInteger(link.expiry) || link.expiry < 0) throw new QantaraLinkError('expiry must be a unix-seconds integer');
  }

  const sig = params.get('sig');
  if (sig) {
    link.signature = sig;
    link.signatureAlg = params.get('sigAlg') ?? 'hmac-sha256';
  }

  return link;
}

/** True if the link carries an expiry that is in the past. */
export function qantaraLinkExpired(link: QantaraPaymentLink, nowSeconds?: number): boolean {
  if (link.expiry === undefined) return false;
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return link.expiry > 0 && now > link.expiry;
}

function qlinkDecimalToBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ''] = amount.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')).toString();
}

/**
 * Convert a Qantara link to an EIP-681 `ethereum:` URI so existing wallets pop a
 * prefilled send screen.
 *   Native: ethereum:0xMerchant@1990?value=<wei>
 *   ERC-20: ethereum:0xToken@1990/transfer?address=0xMerchant&uint256=<units>
 */
export function qantaraLinkToEip681(link: QantaraPaymentLink): string {
  const chainId = link.chainId ?? QANTARA_DEFAULT_CHAIN_ID;
  const isNative = !link.token || link.token === QLINK_ZERO_ADDRESS;
  const decimals = link.decimals ?? 18;

  if (isNative) {
    const base = `ethereum:${qlinkNormalizeAddress(link.to, 'to')}@${chainId}`;
    return link.amount ? `${base}?value=${qlinkDecimalToBaseUnits(link.amount, decimals)}` : base;
  }

  const base = `ethereum:${qlinkNormalizeAddress(link.token!, 'token')}@${chainId}/transfer?address=${qlinkNormalizeAddress(link.to, 'to')}`;
  return link.amount ? `${base}&uint256=${qlinkDecimalToBaseUnits(link.amount, decimals)}` : base;
}

// ---------------------------------------------------------------------------
// Plugin / embed helpers (framework-agnostic, dependency-free)
// ---------------------------------------------------------------------------

function qescapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate an embeddable "Pay with Qantara" button as a self-contained HTML anchor.
 * Works in any site/CMS — no framework. `href` should be a Qantara pay URL or link.
 */
export function payButtonHtml(opts: { href: string; label?: string; color?: string }): string {
  const href = qescapeHtml(opts.href);
  const label = qescapeHtml(opts.label ?? 'Pay with Qantara');
  const color = qescapeHtml(opts.color ?? '#F02C78');
  return (
    `<a href="${href}" target="_blank" rel="noopener" data-qantara-pay-button ` +
    `style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:12px;` +
    `background:${color};color:#fff;font-weight:700;font-family:system-ui,sans-serif;text-decoration:none">` +
    `${label}</a>`
  );
}

/**
 * Generate an embeddable hosted-checkout iframe for an invoice hash.
 */
export function embedCheckoutHtml(opts: { hash: string; baseUrl: string; height?: number }): string {
  const src = qescapeHtml(`${opts.baseUrl.replace(/\/$/, '')}/checkout/${opts.hash}`);
  const height = Number.isFinite(opts.height) ? Math.max(320, Math.floor(opts.height as number)) : 640;
  return (
    `<iframe src="${src}" width="100%" height="${height}" frameborder="0" ` +
    `style="border:0;border-radius:16px;max-width:480px" allow="clipboard-write" ` +
    `title="Qantara checkout"></iframe>`
  );
}

export default Qantara;
