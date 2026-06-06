import { verifyMessage, type Address } from 'viem';
import * as store from './store.js';

export interface SignedInvoicePayload {
  merchant: Address;
  amount: string;
  token: 'QIE' | 'QUSDC';
  invoiceType: number;
  expiresAt: number;
  title?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
  hash?: `0x${string}`;
  chainTxHash?: `0x${string}`;
  nonce: string;
  signedAt: number;
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

export function canonicalInvoiceCreateMessage(payload: SignedInvoicePayload): string {
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

export async function verifyInvoiceCreateSignature(input: {
  payload: SignedInvoicePayload;
  signature: `0x${string}`;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.payload.signedAt) > 10 * 60) {
    return { ok: false, error: 'signature_expired' };
  }
  if (!store.consumeNonce(input.payload.nonce)) {
    return { ok: false, error: 'unknown_or_expired_nonce' };
  }
  const valid = await verifyMessage({
    address: input.payload.merchant,
    message: canonicalInvoiceCreateMessage(input.payload),
    signature: input.signature,
  });
  return valid ? { ok: true } : { ok: false, error: 'invalid_signature' };
}
