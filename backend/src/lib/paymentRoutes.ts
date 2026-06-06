import type { Address } from 'viem';
import * as store from './store.js';
import { railCatalog } from './rails.js';
import { optionalEnv } from './env.js';
import type { AcquisitionRoute } from './qieEcosystem.js';

const QIE_CHAIN_ID = 1990;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

type RouteState = 'ready' | 'blocked' | 'settled' | 'expired' | 'unsupported';

export interface PaymentRouteAction {
  type: 'wallet_sendTransaction' | 'contract_write' | 'erc20_transfer' | 'erc20_approve' | 'typed_data_signature' | 'external_checkout';
  label: string;
  target: Address | null;
  method?: string;
  value?: string;
  amount?: string;
  url?: string;
}

export interface PaymentRouteCandidate {
  id: string;
  rail: 'QIE' | 'QUSDC';
  method: string;
  label: string;
  state: RouteState;
  recommended: boolean;
  reason: string;
  token: {
    symbol: 'QIE' | 'QUSDC' | string;
    address: Address | null;
    decimals: 18 | 6;
  };
  settlementContract: Address | null;
  requiresNativeGas: boolean;
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
  source: 'backend_invoice_and_rail_catalog';
}

export interface PaymentRoutePlan {
  invoiceHash: `0x${string}`;
  chainId: number;
  network: 'QIE Mainnet';
  state: RouteState;
  payable: boolean;
  reason?: string;
  token: {
    symbol: 'QIE' | 'QUSDC' | 'unsupported';
    address: Address;
    decimals: 18 | 6 | null;
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
  dataSources: Array<'sqlite.invoice' | 'backend.rails' | 'qie.rpc.health' | 'deployment.registry'>;
}

function invoiceState(inv: store.Invoice): { state: RouteState; payable: boolean; reason?: string } {
  if (inv.status === store.InvoiceStatus.Paid) return { state: 'settled', payable: false, reason: 'Invoice is already paid' };
  if (inv.status === store.InvoiceStatus.Cancelled) return { state: 'blocked', payable: false, reason: 'Invoice is cancelled' };
  if (inv.status === store.InvoiceStatus.Refunded) return { state: 'settled', payable: false, reason: 'Invoice is refunded' };
  if (inv.status === store.InvoiceStatus.Paused) return { state: 'blocked', payable: false, reason: 'Invoice is paused' };
  const now = Math.floor(Date.now() / 1000);
  if (inv.expiresAt > 0 && inv.expiresAt <= now) return { state: 'expired', payable: false, reason: 'Invoice deadline has passed' };
  return { state: 'ready', payable: true };
}

function tokenSymbol(inv: store.Invoice, qusdcAddress: string | null | undefined): PaymentRoutePlan['token'] {
  if (inv.token.toLowerCase() === ZERO_ADDRESS) {
    return { symbol: 'QIE', address: ZERO_ADDRESS, decimals: 18 };
  }
  if (qusdcAddress && inv.token.toLowerCase() === qusdcAddress.toLowerCase()) {
    return { symbol: 'QUSDC', address: inv.token, decimals: 6 };
  }
  return { symbol: 'unsupported', address: inv.token, decimals: null };
}

function findRail(catalog: any, symbol: 'QIE' | 'QUSDC') {
  return (catalog.rails ?? []).find((rail: any) => String(rail.tokenSymbol).toUpperCase() === symbol);
}

function flowEnabled(rail: any, key: string): { enabled: boolean; reason: string } {
  const flow = (rail?.flows ?? []).find((item: any) => item.key === key || item.id === key);
  if (!flow) return { enabled: false, reason: `Flow ${key} is not present in the backend rail catalog` };
  return { enabled: Boolean(flow.enabled), reason: flow.reason ?? (flow.enabled ? 'Flow is enabled' : 'Flow is disabled') };
}

function routeState(planState: RouteState, flow: { enabled: boolean; reason: string }): { state: RouteState; reason: string } {
  if (planState !== 'ready') return { state: planState, reason: 'Invoice is not payable' };
  if (!flow.enabled) return { state: 'blocked', reason: flow.reason };
  return { state: 'ready', reason: flow.reason };
}

function route(
  input: Omit<PaymentRouteCandidate, 'source'>,
): PaymentRouteCandidate {
  return { ...input, source: 'backend_invoice_and_rail_catalog' };
}

function explorerFor(rail: any, merchant: Address) {
  const txUrlTemplate = rail?.explorer?.txUrlTemplate ?? 'https://mainnet.qie.digital/tx/{txHash}';
  const addressTemplate = rail?.explorer?.addressUrlTemplate ?? 'https://mainnet.qie.digital/address/{address}';
  return {
    merchantUrl: addressTemplate.replace('{address}', merchant),
    tokenUrl: rail?.explorer?.tokenUrl ?? null,
    settlementContractUrl: rail?.explorer?.settlementContractUrl ?? null,
    txUrlTemplate,
  };
}

function paymasterCheckoutUrl(inv: store.Invoice, tokenAddress: Address): string | null {
  const base = optionalEnv('QUSDC_PAYMASTER_CHECKOUT_URL');
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set('invoiceHash', inv.hash);
    url.searchParams.set('amount', inv.amount);
    url.searchParams.set('token', 'QUSDC');
    url.searchParams.set('tokenAddress', tokenAddress);
    url.searchParams.set('merchant', inv.merchant);
    url.searchParams.set('verifyUrl', `/v1/invoices/${inv.hash}/verify-payment`);
    return url.toString();
  } catch {
    return null;
  }
}

export async function buildPaymentRoutePlan(inv: store.Invoice): Promise<PaymentRoutePlan> {
  const catalog = await railCatalog();
  const qieRail = findRail(catalog, 'QIE');
  const qusdcRail = findRail(catalog, 'QUSDC');
  const token = tokenSymbol(inv, catalog.tokens?.qusdc?.address);
  const status = invoiceState(inv);
  const verifyEndpoint = `/v1/invoices/${inv.hash}/verify-payment`;
  const routes: PaymentRouteCandidate[] = [];

  if (token.symbol === 'QIE') {
    const direct = routeState(status.state, flowEnabled(qieRail, 'qie.direct_transfer'));
    routes.push(route({
      id: 'qie.direct_transfer',
      rail: 'QIE',
      method: 'native-transfer',
      label: 'Native QIE direct transfer',
      state: direct.state,
      recommended: direct.state === 'ready',
      reason: direct.reason,
      token: { symbol: 'QIE', address: ZERO_ADDRESS, decimals: 18 },
      settlementContract: null,
      requiresNativeGas: true,
      actions: [{ type: 'wallet_sendTransaction', label: 'Send QIE to merchant', target: inv.merchant, value: inv.amount }],
      verifyEndpoint,
      explorer: explorerFor(qieRail, inv.merchant),
    }));

    const contractFlow = routeState(status.state, flowEnabled(qieRail, 'qie.qantara_invoice'));
    routes.push(route({
      id: 'qie.qantara_invoice',
      rail: 'QIE',
      method: 'contract-pay-invoice-native',
      label: 'Qantara contract invoice payment',
      state: contractFlow.state,
      recommended: false,
      reason: contractFlow.reason,
      token: { symbol: 'QIE', address: ZERO_ADDRESS, decimals: 18 },
      settlementContract: qieRail?.contractAddress ?? null,
      requiresNativeGas: true,
      actions: [{ type: 'contract_write', label: 'Call payInvoiceNative', target: qieRail?.contractAddress ?? null, method: 'payInvoiceNative', value: inv.amount }],
      verifyEndpoint,
      explorer: explorerFor(qieRail, inv.merchant),
    }));
  } else if (token.symbol === 'QUSDC') {
    const q = qusdcRail;
    const tokenAddress = token.address as Address;
    const gaslessUrl = paymasterCheckoutUrl(inv, tokenAddress);
    const gaslessProvider = catalog.paymaster?.qusdc?.provider ?? optionalEnv('QUSDC_PAYMASTER_PROVIDER') ?? 'qie_paymaster';
    const specs = [
      {
        id: 'qusdc.gasless_paymaster',
        method: 'gasless-paymaster',
        label: 'Gasless QUSDC paymaster checkout',
        requiresNativeGas: false,
        provider: gaslessProvider,
        fallbackRouteIds: ['qusdc.permit_and_pay', 'qusdc.approve_and_pay', 'qusdc.direct_transfer'],
        actions: [{ type: 'external_checkout' as const, label: `Open ${gaslessProvider} gasless checkout`, target: null, method: 'open_paymaster_checkout', amount: inv.amount, url: gaslessUrl ?? undefined }],
      },
      {
        id: 'qusdc.direct_transfer',
        method: 'erc20-transfer',
        label: 'QUSDC direct transfer',
        requiresNativeGas: true,
        actions: [{ type: 'erc20_transfer' as const, label: 'Transfer QUSDC to merchant', target: tokenAddress, method: 'transfer', amount: inv.amount }],
      },
      {
        id: 'qusdc.approve_and_pay',
        method: 'approve-and-pay',
        label: 'Approve and pay through Qantara',
        requiresNativeGas: true,
        actions: [
          { type: 'erc20_approve' as const, label: 'Approve Qantara to spend QUSDC', target: tokenAddress, method: 'approve', amount: inv.amount },
          { type: 'contract_write' as const, label: 'Call payInvoiceERC20', target: q?.contractAddress ?? null, method: 'payInvoiceERC20', amount: inv.amount },
        ],
      },
      {
        id: 'qusdc.permit_and_pay',
        method: 'permit-and-pay',
        label: 'Permit and pay through Qantara',
        requiresNativeGas: true,
        actions: [
          { type: 'typed_data_signature' as const, label: 'Sign QUSDC permit', target: tokenAddress, method: 'permit', amount: inv.amount },
          { type: 'contract_write' as const, label: 'Submit permit payment', target: q?.contractAddress ?? null, method: 'payInvoiceERC20WithPermit', amount: inv.amount },
        ],
      },
      {
        id: 'qusdc.transfer_with_authorization',
        method: 'eip3009-authorization',
        label: 'Transfer with authorization',
        requiresNativeGas: true,
        actions: [
          { type: 'typed_data_signature' as const, label: 'Sign EIP-3009 transfer authorization', target: tokenAddress, method: 'transferWithAuthorization', amount: inv.amount },
          { type: 'contract_write' as const, label: 'Submit authorization payment', target: q?.contractAddress ?? null, method: 'payInvoiceERC20WithAuthorization', amount: inv.amount },
        ],
      },
    ];

    const gaslessReady = routeState(status.state, flowEnabled(q, 'qusdc.gasless_paymaster')).state === 'ready';
    for (const spec of specs) {
      const flow = routeState(status.state, flowEnabled(q, spec.id));
      routes.push(route({
        id: spec.id,
        rail: 'QUSDC',
        method: spec.method,
        label: spec.label,
        state: flow.state,
        recommended: (
          (spec.id === 'qusdc.gasless_paymaster' && flow.state === 'ready')
          || (!gaslessReady && spec.id === 'qusdc.approve_and_pay' && flow.state === 'ready')
        ),
        reason: flow.reason,
        token: { symbol: 'QUSDC', address: tokenAddress, decimals: 6 },
        settlementContract: q?.contractAddress ?? null,
        requiresNativeGas: spec.requiresNativeGas,
        provider: spec.provider,
        fallbackRouteIds: spec.fallbackRouteIds,
        actions: spec.actions,
        verifyEndpoint,
        explorer: explorerFor(q, inv.merchant),
      }));
    }
  }

  const recommended = routes.find((candidate) => candidate.recommended && candidate.state === 'ready')
    ?? routes.find((candidate) => candidate.state === 'ready')
    ?? null;
  const acquisitionRoutes: AcquisitionRoute[] = token.symbol === 'QIE'
    ? (qieRail?.acquisitionRoutes ?? [])
    : token.symbol === 'QUSDC'
      ? (qusdcRail?.acquisitionRoutes ?? [])
      : [];

  return {
    invoiceHash: inv.hash,
    chainId: QIE_CHAIN_ID,
    network: 'QIE Mainnet',
    state: token.symbol === 'unsupported' ? 'unsupported' : status.state,
    payable: status.payable && token.symbol !== 'unsupported' && routes.some((candidate) => candidate.state === 'ready'),
    reason: token.symbol === 'unsupported' ? 'Invoice token is not configured as a supported payment rail' : status.reason,
    token,
    amount: inv.amount,
    merchant: inv.merchant,
    payer: inv.payer,
    expiresAt: inv.expiresAt > 0 ? inv.expiresAt : null,
    recommendedRouteId: recommended?.id ?? null,
    routes,
    acquisitionRoutes,
    externalActions: acquisitionRoutes.filter((route) => route.actionType === 'external_link'),
    requiresRealTx: true,
    dataSources: ['sqlite.invoice', 'backend.rails', 'qie.rpc.health', 'deployment.registry'],
  };
}
