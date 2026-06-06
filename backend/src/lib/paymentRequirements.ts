import { createHmac } from 'node:crypto';
import type { Address } from 'viem';
import { optionalEnv } from './env.js';
import * as store from './store.js';

const QIE_CHAIN_ID = 1990;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export type PaymentRequirementState =
  | 'open'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'refunded'
  | 'paused'
  | 'unsupported_token';

export interface SignedPaymentRequirement {
  version: '2026-06-03';
  invoiceHash: `0x${string}`;
  chainId: number;
  network: 'QIE Mainnet';
  rail: 'qie-native' | 'qusdc-erc20';
  method: 'native-transfer' | 'erc20-transfer';
  amount: string;
  token: {
    symbol: 'QIE' | 'QUSDC';
    address: Address;
    decimals: 18 | 6;
    standard: 'native' | 'erc20';
  };
  merchant: Address;
  payer?: Address;
  deadline: number | null;
  expiresAt: number | null;
  verifyEndpoint: string;
  payUrl?: string;
  signature: string;
  signatureAlgorithm: 'hmac-sha256';
}

export interface PaymentRequirementResponse {
  invoiceHash: `0x${string}`;
  state: PaymentRequirementState;
  payable: boolean;
  reason?: string;
  requirement: SignedPaymentRequirement | null;
}

function paymentRequirementSecret(): string {
  const secret = optionalEnv('PAYMENT_REQUIREMENT_SECRET')
    ?? optionalEnv('PAYMENT_INTENT_SECRET')
    ?? optionalEnv('WEBHOOK_SECRET')
    ?? optionalEnv('API_KEY');
  if (!secret) throw new Error('PAYMENT_REQUIREMENT_SECRET, PAYMENT_INTENT_SECRET, WEBHOOK_SECRET, or API_KEY is required');
  return secret;
}

function canonicalRequirement(requirement: Omit<SignedPaymentRequirement, 'signature' | 'signatureAlgorithm'>): string {
  return JSON.stringify({
    version: requirement.version,
    invoiceHash: requirement.invoiceHash.toLowerCase(),
    chainId: requirement.chainId,
    network: requirement.network,
    rail: requirement.rail,
    method: requirement.method,
    amount: requirement.amount,
    token: {
      symbol: requirement.token.symbol,
      address: requirement.token.address.toLowerCase(),
      decimals: requirement.token.decimals,
      standard: requirement.token.standard,
    },
    merchant: requirement.merchant.toLowerCase(),
    payer: requirement.payer?.toLowerCase() ?? null,
    deadline: requirement.deadline,
    expiresAt: requirement.expiresAt,
    verifyEndpoint: requirement.verifyEndpoint,
    payUrl: requirement.payUrl ?? null,
  });
}

function signRequirement(requirement: Omit<SignedPaymentRequirement, 'signature' | 'signatureAlgorithm'>): string {
  return createHmac('sha256', paymentRequirementSecret()).update(canonicalRequirement(requirement)).digest('hex');
}

function statusState(status: store.InvoiceStatusValue): Exclude<PaymentRequirementState, 'open' | 'expired' | 'unsupported_token'> | undefined {
  if (status === store.InvoiceStatus.Paid) return 'paid';
  if (status === store.InvoiceStatus.Cancelled) return 'cancelled';
  if (status === store.InvoiceStatus.Refunded) return 'refunded';
  if (status === store.InvoiceStatus.Paused) return 'paused';
  return undefined;
}

function frontendPayUrl(invoiceHash: string): string | undefined {
  const frontend = optionalEnv('QANTARA_FRONTEND_URL');
  if (!frontend) return undefined;
  try {
    const url = new URL(frontend);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/pay/${invoiceHash}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function resolveToken(inv: store.Invoice): {
  rail: SignedPaymentRequirement['rail'];
  method: SignedPaymentRequirement['method'];
  symbol: SignedPaymentRequirement['token']['symbol'];
  address: Address;
  decimals: SignedPaymentRequirement['token']['decimals'];
  standard: SignedPaymentRequirement['token']['standard'];
} | undefined {
  if (inv.token.toLowerCase() === ZERO_ADDRESS) {
    return {
      rail: 'qie-native',
      method: 'native-transfer',
      symbol: 'QIE',
      address: ZERO_ADDRESS,
      decimals: 18,
      standard: 'native',
    };
  }

  const qusdc = optionalEnv('QUSDC_ADDRESS');
  if (qusdc && ADDRESS_RE.test(qusdc) && inv.token.toLowerCase() === qusdc.toLowerCase()) {
    return {
      rail: 'qusdc-erc20',
      method: 'erc20-transfer',
      symbol: 'QUSDC',
      address: qusdc as Address,
      decimals: 6,
      standard: 'erc20',
    };
  }

  return undefined;
}

export function buildPaymentRequirement(inv: store.Invoice): PaymentRequirementResponse {
  const status = statusState(inv.status);
  if (status) {
    return {
      invoiceHash: inv.hash,
      state: status,
      payable: false,
      reason: `Invoice is ${status}`,
      requirement: null,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (inv.expiresAt > 0 && inv.expiresAt <= now) {
    return {
      invoiceHash: inv.hash,
      state: 'expired',
      payable: false,
      reason: 'Invoice deadline has passed',
      requirement: null,
    };
  }

  const token = resolveToken(inv);
  if (!token) {
    return {
      invoiceHash: inv.hash,
      state: 'unsupported_token',
      payable: false,
      reason: 'Invoice token is not configured as a supported Qantara payment rail',
      requirement: null,
    };
  }

  const unsigned: Omit<SignedPaymentRequirement, 'signature' | 'signatureAlgorithm'> = {
    version: '2026-06-03',
    invoiceHash: inv.hash,
    chainId: QIE_CHAIN_ID,
    network: 'QIE Mainnet',
    rail: token.rail,
    method: token.method,
    amount: inv.amount,
    token: {
      symbol: token.symbol,
      address: token.address,
      decimals: token.decimals,
      standard: token.standard,
    },
    merchant: inv.merchant,
    payer: inv.payer ?? undefined,
    deadline: inv.expiresAt > 0 ? inv.expiresAt : null,
    expiresAt: inv.expiresAt > 0 ? inv.expiresAt : null,
    verifyEndpoint: `/v1/invoices/${inv.hash}/verify-payment`,
    payUrl: frontendPayUrl(inv.hash),
  };

  return {
    invoiceHash: inv.hash,
    state: 'open',
    payable: true,
    requirement: {
      ...unsigned,
      signature: signRequirement(unsigned),
      signatureAlgorithm: 'hmac-sha256',
    },
  };
}
