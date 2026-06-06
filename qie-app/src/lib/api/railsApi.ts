import { zeroAddress, type Address } from 'viem';
import type {
  PaymentRouteAction as SdkPaymentRouteAction,
  PaymentRouteCandidate as SdkPaymentRouteCandidate,
  PaymentRoutePlan as SdkPaymentRoutePlan,
} from '@qie/qantara-sdk';
import { qieMainnet } from '../../config/wagmi';
import { getField, parseJson, QANTARA_BACKEND_URL, stringOrNull } from './http';
import { tokenSymbol } from './tokens';
import type { AcquisitionRoute, QieEcosystem, QieNetworkCatalog } from './qieApi';

export type PaymentRailStatus = 'active' | 'degraded' | 'disabled' | 'unknown';
export type PaymentFlowStatus = 'active' | 'degraded' | 'disabled' | 'unknown';

export interface PaymentRail {
  id: string;
  chainId: number;
  chainName: string;
  tokenSymbol: 'QIE' | 'QUSDC' | string;
  tokenAddress: Address | null;
  contractAddress: Address | null;
  status: PaymentRailStatus;
  flows: Array<{ id: string; label: string; status: PaymentFlowStatus }>;
  explorer?: {
    tokenUrl?: string | null;
    settlementContractUrl?: string | null;
    addressUrl?: string | null;
    txUrlTemplate?: string | null;
    addressUrlTemplate?: string | null;
  };
  acquisitionRoutes?: AcquisitionRoute[];
  externalActions?: AcquisitionRoute[];
  requiresRealTx?: boolean;
  source: 'backend';
}

export interface PaymentWalletSupport {
  id: string;
  name: string;
  type?: string;
  connection?: string;
  status?: string;
  reason?: string;
}

export interface PaymentRailCatalog {
  rails: PaymentRail[];
  source: 'backend';
  wallets: PaymentWalletSupport[];
  networkCatalog?: QieNetworkCatalog;
  ecosystem?: QieEcosystem;
  acquisitionRoutes: AcquisitionRoute[];
  externalActions: AcquisitionRoute[];
  requiresRealTx: boolean;
  explorer: {
    baseUrl: string;
    txUrlTemplate: string;
    addressUrlTemplate: string;
  };
}

export interface QusdcCapabilityProbe {
  supported: boolean;
  status: 'ready' | 'disabled' | 'degraded';
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
  source: 'qie_rpc_contract_probe';
}

export type PaymentRequirementState = 'ready' | 'pending' | 'paid' | 'expired' | 'disabled' | 'unknown';

export interface PaymentRequirement {
  id: string;
  invoiceHash: string;
  scheme: string;
  chainId: number;
  chainName: string;
  tokenSymbol: string;
  tokenAddress: Address | null;
  amount: string;
  merchant: Address | null;
  payer?: Address | null;
  verifyUrl?: string;
  payUrl?: string;
  state: PaymentRequirementState;
  source: 'backend';
}

export interface PaymentRequirementsResponse {
  invoiceHash: string;
  requirements: PaymentRequirement[];
  verifyUrl?: string;
  state: PaymentRequirementState;
  source: 'backend';
}

export type PaymentRouteAction = SdkPaymentRouteAction;
export type PaymentRouteCandidate = SdkPaymentRouteCandidate;
export type PaymentRoutePlan = SdkPaymentRoutePlan;

function normalizeRailStatus(value: unknown): PaymentRailStatus {
  const status = String(value ?? '').toLowerCase();
  if (status === 'active' || status === 'enabled' || status === 'ready' || status === 'ok') return 'active';
  if (status === 'degraded' || status === 'warning') return 'degraded';
  if (status === 'disabled' || status === 'unavailable' || status === 'off') return 'disabled';
  return 'unknown';
}

function normalizeFlowStatus(value: unknown): PaymentFlowStatus {
  return normalizeRailStatus(value);
}

function normalizeRequirementState(value: unknown): PaymentRequirementState {
  const state = String(value ?? '').toLowerCase();
  if (state === 'ready' || state === 'open' || state === 'created' || state === 'active') return 'ready';
  if (state === 'pending' || state === 'submitted' || state === 'verifying') return 'pending';
  if (state === 'paid' || state === 'settled' || state === 'confirmed') return 'paid';
  if (state === 'expired') return 'expired';
  if (state === 'disabled' || state === 'unavailable') return 'disabled';
  return 'unknown';
}

function formatFlowLabel(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizePaymentRail(raw: unknown, source: 'backend' = 'backend'): PaymentRail | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const tokenValue = getField<Record<string, unknown> | string>(value, 'token', 'asset');
  const tokenObject = tokenValue && typeof tokenValue === 'object' ? tokenValue as Record<string, unknown> : null;
  const chainValue = getField<Record<string, unknown> | string | number>(value, 'chain', 'network');
  const chainObject = chainValue && typeof chainValue === 'object' ? chainValue as Record<string, unknown> : null;
  const chainId = Number(
    getField(value, 'chainId', 'chain_id')
    ?? getField(chainObject ?? {}, 'id', 'chainId', 'chain_id')
    ?? qieMainnet.id,
  );
  const rawTokenAddress =
    getField<string | null>(value, 'tokenAddress', 'token_address', 'tokenContract', 'token_contract')
    ?? getField<string | null>(tokenObject ?? {}, 'address', 'contract', 'contractAddress', 'contract_address')
    ?? null;
  const tokenSym = String(
    getField(value, 'tokenSymbol', 'token_symbol', 'symbol')
    ?? getField(tokenObject ?? {}, 'symbol')
    ?? (rawTokenAddress && String(rawTokenAddress).toLowerCase() === zeroAddress ? 'QIE' : String(tokenValue).toUpperCase() === 'QIE' ? 'QIE' : 'QUSDC'),
  ).toUpperCase();
  const tokenAddress = rawTokenAddress ? String(rawTokenAddress) : tokenSym === 'QIE' ? zeroAddress : null;
  const flowsValue = getField<unknown>(value, 'flows', 'flowStatus', 'flow_status') ?? [];
  const flowEntries = Array.isArray(flowsValue)
    ? flowsValue
    : Object.entries(flowsValue && typeof flowsValue === 'object' ? flowsValue as Record<string, unknown> : {});
  const flows = flowEntries.flatMap((entry) => {
    if (Array.isArray(entry)) {
      const [id, status] = entry;
      return [{ id, label: formatFlowLabel(id), status: normalizeFlowStatus(status) }];
    }
    if (!entry || typeof entry !== 'object') return [];
    const flow = entry as Record<string, unknown>;
    const id = String(getField(flow, 'id', 'key', 'name') ?? 'payment');
    return [{
      id,
      label: String(getField(flow, 'label', 'name') ?? formatFlowLabel(id)),
      status: normalizeFlowStatus(getField(flow, 'status', 'state')),
    }];
  });

  if (Number.isNaN(chainId)) return null;

  return {
    id: String(getField(value, 'id', 'key') ?? `${chainId}:${tokenSym}`),
    chainId,
    chainName: String(getField(value, 'chainName', 'chain_name') ?? getField(chainObject ?? {}, 'name', 'label') ?? qieMainnet.name),
    tokenSymbol: tokenSym,
    tokenAddress: tokenAddress as Address | null,
    contractAddress: (getField<string>(value, 'contractAddress', 'contract_address', 'settlementContract', 'settlement_contract') ?? null) as Address | null,
    status: normalizeRailStatus(getField(value, 'status', 'state')),
    flows,
    explorer: (() => {
      const explorerValue = getField<Record<string, unknown>>(value, 'explorer', 'links');
      if (!explorerValue || typeof explorerValue !== 'object') return undefined;
      return {
        tokenUrl: stringOrNull(getField(explorerValue, 'tokenUrl', 'token_url')),
        settlementContractUrl: stringOrNull(getField(explorerValue, 'settlementContractUrl', 'settlement_contract_url', 'contractUrl', 'contract_url')),
        addressUrl: stringOrNull(getField(explorerValue, 'addressUrl', 'address_url')),
        txUrlTemplate: stringOrNull(getField(explorerValue, 'txUrlTemplate', 'tx_url_template')),
        addressUrlTemplate: stringOrNull(getField(explorerValue, 'addressUrlTemplate', 'address_url_template')),
      };
    })(),
    acquisitionRoutes: Array.isArray(getField(value, 'acquisitionRoutes', 'acquisition_routes'))
      ? getField<AcquisitionRoute[]>(value, 'acquisitionRoutes', 'acquisition_routes')
      : [],
    externalActions: Array.isArray(getField(value, 'externalActions', 'external_actions'))
      ? getField<AcquisitionRoute[]>(value, 'externalActions', 'external_actions')
      : [],
    requiresRealTx: getField<boolean>(value, 'requiresRealTx', 'requires_real_tx') ?? true,
    source,
  };
}

export function emptyPaymentRailCatalog(): PaymentRailCatalog {
  return {
    rails: [],
    source: 'backend',
    wallets: [],
    acquisitionRoutes: [],
    externalActions: [],
    requiresRealTx: true,
    explorer: {
      baseUrl: qieMainnet.blockExplorers.default.url,
      txUrlTemplate: `${qieMainnet.blockExplorers.default.url}/tx/{txHash}`,
      addressUrlTemplate: `${qieMainnet.blockExplorers.default.url}/address/{address}`,
    },
  };
}

export function railForToken(catalog: PaymentRailCatalog | null | undefined, token: string): PaymentRail | null {
  const symbol = tokenSymbol(token);
  return catalog?.rails.find((rail) => rail.tokenSymbol.toUpperCase() === symbol && rail.chainId === qieMainnet.id) ?? null;
}

export function normalizePaymentRequirement(raw: unknown, invoiceHash = ''): PaymentRequirement | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const tokenValue = getField<Record<string, unknown> | string>(value, 'token', 'asset');
  const tokenObject = tokenValue && typeof tokenValue === 'object' ? tokenValue as Record<string, unknown> : null;
  const chainValue = getField<Record<string, unknown> | string | number>(value, 'chain', 'network');
  const chainObject = chainValue && typeof chainValue === 'object' ? chainValue as Record<string, unknown> : null;
  const chainId = Number(
    getField(value, 'chainId', 'chain_id')
    ?? getField(chainObject ?? {}, 'id', 'chainId', 'chain_id')
    ?? qieMainnet.id,
  );
  if (Number.isNaN(chainId)) return null;

  const rawTokenAddress =
    getField<string | null>(value, 'tokenAddress', 'token_address', 'tokenContract', 'token_contract')
    ?? getField<string | null>(tokenObject ?? {}, 'address', 'contract', 'contractAddress', 'contract_address')
    ?? null;
  const symbol = String(
    getField(value, 'tokenSymbol', 'token_symbol', 'symbol')
    ?? getField(tokenObject ?? {}, 'symbol')
    ?? (rawTokenAddress && rawTokenAddress.toLowerCase() === zeroAddress ? 'QIE' : 'QUSDC'),
  ).toUpperCase();
  const normalizedInvoiceHash = String(getField(value, 'invoiceHash', 'invoice_hash', 'hash') ?? invoiceHash);

  return {
    id: String(getField(value, 'id', 'key') ?? `${normalizedInvoiceHash || 'invoice'}:${symbol}:${chainId}`),
    invoiceHash: normalizedInvoiceHash,
    scheme: String(getField(value, 'scheme', 'type', 'paymentScheme', 'payment_scheme') ?? 'qantara'),
    chainId,
    chainName: String(getField(value, 'chainName', 'chain_name') ?? getField(chainObject ?? {}, 'name', 'label') ?? qieMainnet.name),
    tokenSymbol: symbol,
    tokenAddress: (rawTokenAddress ? String(rawTokenAddress) : symbol === 'QIE' ? zeroAddress : null) as Address | null,
    amount: String(getField(value, 'amount', 'amountRequired', 'amount_required', 'value') ?? ''),
    merchant: (getField<string>(value, 'merchant', 'merchantAddress', 'merchant_address', 'recipient') ?? null) as Address | null,
    payer: (getField<string | null>(value, 'payer', 'payerAddress', 'payer_address') ?? null) as Address | null,
    verifyUrl: getField<string>(value, 'verifyUrl', 'verify_url', 'verificationUrl', 'verification_url'),
    payUrl: getField<string>(value, 'payUrl', 'pay_url', 'paymentUrl', 'payment_url'),
    state: normalizeRequirementState(getField(value, 'state', 'status')),
    source: 'backend',
  };
}

export function normalizePaymentRequirementsResponse(raw: unknown, invoiceHash: string): PaymentRequirementsResponse {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const resolvedHash = String(getField(body, 'invoiceHash', 'invoice_hash', 'hash') ?? invoiceHash);
  const rawRequirements =
    getField<unknown[]>(body, 'paymentRequirements', 'payment_requirements', 'requirements')
    ?? (Array.isArray(raw) ? raw : []);
  const requirements = rawRequirements.flatMap((item) => {
    const requirement = normalizePaymentRequirement(item, resolvedHash);
    return requirement ? [requirement] : [];
  });
  const nestedRequirement = getField<unknown>(body, 'requirement');
  const singleRequirement = requirements.length === 0 && !Array.isArray(raw)
    ? normalizePaymentRequirement(nestedRequirement ?? raw, resolvedHash)
    : null;

  return {
    invoiceHash: resolvedHash,
    requirements: singleRequirement ? [singleRequirement] : requirements,
    verifyUrl: getField<string>(body, 'verifyUrl', 'verify_url', 'verificationUrl', 'verification_url'),
    state: normalizeRequirementState(getField(body, 'state', 'status')),
    source: 'backend',
  };
}

export async function getPaymentRailCatalog(): Promise<PaymentRailCatalog> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/rails`);
  const body = await parseJson<{
    rails?: unknown[];
    wallets?: unknown[];
    network?: { explorer?: Record<string, unknown> };
    explorer?: Record<string, unknown>;
    networkCatalog?: QieNetworkCatalog;
    ecosystem?: QieEcosystem;
    acquisitionRoutes?: AcquisitionRoute[];
    externalActions?: AcquisitionRoute[];
    requiresRealTx?: boolean;
  } | unknown[]>(res);
  const rawRails = Array.isArray(body) ? body : Array.isArray(body.rails) ? body.rails : [];
  const rails = rawRails.flatMap((rail) => {
    const normalized = normalizePaymentRail(rail, 'backend');
    return normalized ? [normalized] : [];
  });
  if (rails.length === 0) return emptyPaymentRailCatalog();

  const rawWallets = Array.isArray(body) ? [] : Array.isArray(body.wallets) ? body.wallets : [];
  const wallets = rawWallets.flatMap((wallet) => {
    if (!wallet || typeof wallet !== 'object') return [];
    const value = wallet as Record<string, unknown>;
    const id = stringOrNull(getField(value, 'id', 'key'));
    const name = stringOrNull(getField(value, 'name', 'label'));
    if (!id || !name) return [];
    return [{
      id,
      name,
      type: stringOrNull(getField(value, 'type')) ?? undefined,
      connection: stringOrNull(getField(value, 'connection')) ?? undefined,
      status: stringOrNull(getField(value, 'status')) ?? undefined,
      reason: stringOrNull(getField(value, 'reason')) ?? undefined,
    }];
  });
  const explorerSource = Array.isArray(body) ? null : (body.network?.explorer ?? body.explorer ?? null);
  return {
    rails,
    source: 'backend',
    wallets,
    networkCatalog: Array.isArray(body) ? undefined : body.networkCatalog,
    ecosystem: Array.isArray(body) ? undefined : body.ecosystem,
    acquisitionRoutes: Array.isArray(body) ? [] : Array.isArray(body.acquisitionRoutes) ? body.acquisitionRoutes : [],
    externalActions: Array.isArray(body) ? [] : Array.isArray(body.externalActions) ? body.externalActions : [],
    requiresRealTx: Array.isArray(body) ? true : body.requiresRealTx ?? true,
    explorer: {
      baseUrl: stringOrNull(explorerSource?.baseUrl) ?? qieMainnet.blockExplorers.default.url,
      txUrlTemplate: stringOrNull(explorerSource?.txUrlTemplate) ?? `${qieMainnet.blockExplorers.default.url}/tx/{txHash}`,
      addressUrlTemplate: stringOrNull(explorerSource?.addressUrlTemplate) ?? `${qieMainnet.blockExplorers.default.url}/address/{address}`,
    },
  };
}

export async function getPaymentRequirements(hash: string): Promise<PaymentRequirementsResponse> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/payment-requirements/${encodeURIComponent(hash)}`);
  const body = await parseJson<unknown>(res);
  return normalizePaymentRequirementsResponse(body, hash);
}

export async function getPaymentRoutePlan(hash: string): Promise<PaymentRoutePlan> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/payment-routes/${encodeURIComponent(hash)}`);
  return parseJson<PaymentRoutePlan>(res);
}

export async function getQusdcCapabilities(): Promise<QusdcCapabilityProbe> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/rails/qusdc/capabilities`);
  return parseJson<QusdcCapabilityProbe>(res);
}
