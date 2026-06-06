import { randomUUID } from 'node:crypto';
import { type Address } from 'viem';

import { db, nowSeconds } from '../db.js';
import { appendInvoiceEvent } from './invoices.js';

export interface PaymentIntent {
  id: string;
  invoiceHash: `0x${string}`;
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

function mapPaymentIntent(row: any): PaymentIntent {
  return {
    id: row.id,
    invoiceHash: row.invoice_hash,
    merchant: row.merchant,
    payer: row.payer ?? undefined,
    token: row.token,
    amount: row.amount,
    deadline: row.deadline,
    nonce: row.nonce,
    signature: row.signature,
    createdAt: row.created_at,
    usedAt: row.used_at ?? undefined,
  };
}

export function createPaymentIntent(input: {
  invoiceHash: `0x${string}`;
  merchant: Address;
  payer?: Address;
  token: Address;
  amount: string;
  deadline: number;
  nonce: string;
  signature: string;
}): PaymentIntent {
  const id = `pi_${randomUUID()}`;
  db.prepare(`
    INSERT INTO payment_intents (
      id, invoice_hash, merchant, payer, token, amount, deadline, nonce, signature, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.invoiceHash.toLowerCase(),
    input.merchant.toLowerCase(),
    input.payer?.toLowerCase() ?? null,
    input.token.toLowerCase(),
    input.amount,
    input.deadline,
    input.nonce,
    input.signature,
    nowSeconds(),
  );
  appendInvoiceEvent(input.invoiceHash, 'payment_intent.created', {
    intentId: id,
    deadline: input.deadline,
    payer: input.payer?.toLowerCase(),
  });
  return getPaymentIntent(id)!;
}

export function getPaymentIntent(id: string): PaymentIntent | undefined {
  const row = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id);
  return row ? mapPaymentIntent(row) : undefined;
}

export function listPaymentIntents(filter: { invoiceHash?: string; merchant?: Address; limit?: number; offset?: number } = {}): { intents: PaymentIntent[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.invoiceHash) {
    clauses.push('lower(invoice_hash) = lower(?)');
    params.push(filter.invoiceHash);
  }
  if (filter.merchant) {
    clauses.push('lower(merchant) = lower(?)');
    params.push(filter.merchant);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM payment_intents${where}`).get(...params) as { c: number };
  const limit = Math.max(1, Math.min(200, filter.limit ?? 100));
  const offset = Math.max(0, filter.offset ?? 0);
  const intents = db
    .prepare(`SELECT * FROM payment_intents${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(mapPaymentIntent);
  return { intents, total: Number(totalRow?.c ?? 0) };
}

export function markPaymentIntentUsed(id: string): PaymentIntent | undefined {
  db.prepare('UPDATE payment_intents SET used_at = ? WHERE id = ? AND used_at IS NULL').run(nowSeconds(), id);
  return getPaymentIntent(id);
}
