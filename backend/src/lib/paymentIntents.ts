import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Address } from 'viem';
import { optionalEnv } from './env.js';
import * as store from './store.js';

export interface PaymentIntentPayload {
  invoiceHash: `0x${string}`;
  merchant: Address;
  payer?: Address;
  token: Address;
  amount: string;
  deadline: number;
  nonce: string;
}

function signingSecret(): string {
  const secret = optionalEnv('PAYMENT_INTENT_SECRET') ?? optionalEnv('WEBHOOK_SECRET') ?? optionalEnv('API_KEY');
  if (!secret) {
    throw new Error('PAYMENT_INTENT_SECRET, WEBHOOK_SECRET, or API_KEY is required to sign payment intents');
  }
  return secret;
}

export function canonicalPaymentIntent(payload: PaymentIntentPayload): string {
  return JSON.stringify({
    invoiceHash: payload.invoiceHash.toLowerCase(),
    merchant: payload.merchant.toLowerCase(),
    payer: payload.payer?.toLowerCase() ?? null,
    token: payload.token.toLowerCase(),
    amount: payload.amount,
    deadline: payload.deadline,
    nonce: payload.nonce,
  });
}

export function signPaymentIntent(payload: PaymentIntentPayload): string {
  return createHmac('sha256', signingSecret()).update(canonicalPaymentIntent(payload)).digest('hex');
}

export function verifyPaymentIntent(payload: PaymentIntentPayload, signature: string): boolean {
  const expected = Buffer.from(signPaymentIntent(payload), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function buildPaymentIntent(input: {
  invoice: store.Invoice;
  payer?: Address;
  ttlSeconds?: number;
}): store.PaymentIntent {
  const ttlSeconds = Math.max(60, Math.min(7 * 24 * 60 * 60, input.ttlSeconds ?? 3600));
  const payload: PaymentIntentPayload = {
    invoiceHash: input.invoice.hash,
    merchant: input.invoice.merchant,
    payer: input.payer,
    token: input.invoice.token,
    amount: input.invoice.amount,
    deadline: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: `pin_${randomBytes(16).toString('base64url')}`,
  };
  const signature = signPaymentIntent(payload);
  return store.createPaymentIntent({ ...payload, signature });
}
