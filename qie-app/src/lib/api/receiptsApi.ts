import type { Address } from 'viem';
import type {
  QantaraReceipt as SdkQantaraReceipt,
  ReceiptVerification as SdkReceiptVerification,
  ReceiptsStatusResponse as SdkReceiptsStatusResponse,
} from '@qie/qantara-sdk';
import { InvoiceStatus, type QantaraInvoice } from './base';
import { tokenSymbol } from './tokens';
import { operationalHeaders, parseJson, QANTARA_BACKEND_URL } from './http';

export type ReceiptRecord = SdkQantaraReceipt;
export type ReceiptVerification = SdkReceiptVerification;
export type ReceiptsStatus = SdkReceiptsStatusResponse;

export type VerificationTone = 'good' | 'warn' | 'neutral';

export function receiptVerificationState(
  invoice: Pick<QantaraInvoice, 'status' | 'paidTxHash'> | null | undefined,
  receipt: Pick<ReceiptRecord, 'receiptHash' | 'txHash' | 'verification'> | null | undefined,
): { label: string; detail: string; tone: VerificationTone } {
  if (receipt) {
    if (receipt.verification?.anchored) {
      return {
        label: 'Receipt anchored',
        detail: 'Receipt record is anchored on-chain and linked to the verified payment',
        tone: 'good',
      };
    }
    return {
      label: 'Receipt issued',
      detail: receipt.verification?.onChainAnchor.enabled
        ? 'Persisted receipt record is ready for optional on-chain anchoring'
        : 'Persisted backend receipt record is the source of truth',
      tone: 'good',
    };
  }

  if (invoice?.status === InvoiceStatus.Paid && invoice.paidTxHash) {
    return {
      label: 'Payment verified',
      detail: 'Backend paid status is verified; receipt record is pending',
      tone: 'warn',
    };
  }

  if (invoice?.status === InvoiceStatus.Paid) {
    return {
      label: 'Payment review',
      detail: 'Backend paid status is missing a transaction hash',
      tone: 'warn',
    };
  }

  return {
    label: 'No verified receipt',
    detail: 'Receipt appears after QIE RPC verification',
    tone: 'neutral',
  };
}

export function receiptRecordFilename(receipt: Pick<ReceiptRecord, 'invoiceHash'>): string {
  return `receipt-${receipt.invoiceHash.slice(0, 10)}.json`;
}

export function buildReceiptRecordExport(
  receipt: ReceiptRecord,
  options: { explorerUrl: string; networkLabel: string },
) {
  return {
    id: receipt.id,
    invoiceHash: receipt.invoiceHash,
    receiptHash: receipt.receiptHash,
    txHash: receipt.txHash,
    payer: receipt.payer,
    merchant: receipt.merchant,
    amount: receipt.amount,
    token: tokenSymbol(receipt.token),
    tokenAddress: receipt.token,
    issuedAt: new Date(receipt.issuedAt * 1000).toISOString(),
    network: options.networkLabel,
    explorerTxUrl: `${options.explorerUrl}/tx/${receipt.txHash}`,
    verification: receipt.verification ?? null,
  };
}

export function buildReceiptRecordShareText(
  receipt: ReceiptRecord,
  options: { explorerUrl: string; networkLabel: string },
): string {
  const exported = buildReceiptRecordExport(receipt, options);
  return [
    'Qantara receipt',
    `Invoice: ${exported.invoiceHash}`,
    `Receipt: ${exported.receiptHash}`,
    `Amount: ${exported.amount} ${exported.token}`,
    `Network: ${exported.network}`,
    `Tx: ${exported.explorerTxUrl}`,
  ].join('\n');
}

export async function getReceipt(hash: string): Promise<ReceiptRecord | null> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/receipts/${encodeURIComponent(hash)}`);
  if (res.status === 404) return null;
  return parseJson<ReceiptRecord>(res);
}

export async function getReceiptsStatus(): Promise<ReceiptsStatus> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/receipts/status`);
  return parseJson<ReceiptsStatus>(res);
}

export async function listReceipts(filter: { merchant?: Address; limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (filter.merchant) params.set('merchant', filter.merchant);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/receipts?${params}`, {
    headers: operationalHeaders(),
  });
  return parseJson<{ count: number; total: number; receipts: ReceiptRecord[] }>(res);
}
