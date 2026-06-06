import type { Hex } from 'viem';
import type { BackendInvoice as QantaraInvoice } from '../dealRoom';
import { getGuestToken, QANTARA_BACKEND_URL } from '../dealRoom';
import { merchantActionHeaders, parseJson } from './http';

// Merchant browser operations use SIWE session auth. API keys stay server-side.

async function postMerchantAction(hash: string, action: string, body: object = {}): Promise<QantaraInvoice> {
  const res = await fetch(
    `${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}/${action}`,
    {
      method: 'POST',
      headers: merchantActionHeaders(),
      body: JSON.stringify(body),
    },
  );
  const parsed = await parseJson<{ ok: boolean; invoice: QantaraInvoice }>(res);
  return parsed.invoice;
}

export function verifyContractRefund(hash: string, txHash: Hex): Promise<QantaraInvoice> {
  return postMerchantAction(hash, 'refund/verify-contract', { tx_hash: txHash });
}

export async function requestPayerRefund(hash: string, reason?: string): Promise<QantaraInvoice> {
  const guestToken = getGuestToken(hash);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (guestToken) headers['x-qantara-guest-token'] = guestToken;
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}/refund/request`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason }),
  });
  const parsed = await parseJson<{ ok: boolean; invoice: QantaraInvoice }>(res);
  return parsed.invoice;
}

export function approveRefundRequest(hash: string, message?: string, txHash?: Hex): Promise<QantaraInvoice> {
  return postMerchantAction(hash, 'refund/approve', { message, tx_hash: txHash });
}

export function rejectRefundRequest(hash: string, message?: string): Promise<QantaraInvoice> {
  return postMerchantAction(hash, 'refund/reject', { message });
}

export async function openDispute(hash: string, reason?: string): Promise<QantaraInvoice> {
  const guestToken = getGuestToken(hash);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (guestToken) headers['x-qantara-guest-token'] = guestToken;
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}/dispute/open`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason }),
  });
  const parsed = await parseJson<{ ok: boolean; invoice: QantaraInvoice }>(res);
  return parsed.invoice;
}

export function resolveDispute(hash: string, resolution: 'refunded' | 'rejected' | 'resolved', message?: string): Promise<QantaraInvoice> {
  return postMerchantAction(hash, 'dispute/resolve', { resolution, message });
}

export function refundInvoice(hash: string, reason?: string): Promise<QantaraInvoice> {
  void hash;
  void reason;
  return Promise.reject(new Error('Refunds require a merchant wallet transaction followed by verifyContractRefund(txHash).'));
}

export function verifyLifecycleAction(
  hash: string,
  action: 'cancel' | 'pause' | 'resume',
  txHash: Hex,
): Promise<QantaraInvoice> {
  return postMerchantAction(hash, `${action}/verify`, { tx_hash: txHash });
}
