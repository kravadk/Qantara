import { tokenSymbol, typeLabel } from './qantaraApi';
import type { QantaraInvoice } from './qantaraApi';

type ReceiptInvoice = Pick<
  QantaraInvoice,
  | 'hash'
  | 'invoiceType'
  | 'amount'
  | 'token'
  | 'merchant'
  | 'payer'
  | 'createdAt'
  | 'paidAt'
  | 'paidTxHash'
  | 'memo'
  | 'title'
>;

export interface ReceiptPdfModel {
  filename: string;
  title: string;
  amount: string;
  networkLabel: string;
  rows: Array<[string, string]>;
}

export function buildReceiptPdfFilename(hash: string) {
  return `receipt-${hash.slice(0, 10)}.pdf`;
}

export function buildReceiptCsv(invoices: ReceiptInvoice[]) {
  const header = ['hash', 'invoiceType', 'amount', 'token', 'merchant', 'payer', 'createdAt', 'paidAt', 'txHash', 'memo'];
  const rows = invoices.map((i) => [
    i.hash,
    typeLabel(i.invoiceType),
    i.amount,
    tokenSymbol(i.token),
    i.merchant,
    i.payer ?? '',
    new Date(i.createdAt * 1000).toISOString(),
    i.paidAt ? new Date(i.paidAt * 1000).toISOString() : '',
    i.paidTxHash ?? '',
    i.memo ?? '',
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function buildReceiptPdfModel(
  invoice: ReceiptInvoice,
  options: { explorerUrl: string; networkLabel: string },
): ReceiptPdfModel {
  const txHash = invoice.paidTxHash ?? '';
  const explorer = txHash ? `${options.explorerUrl}/tx/${txHash}` : '';

  return {
    filename: buildReceiptPdfFilename(invoice.hash),
    title: invoice.title || invoice.memo || `Invoice ${invoice.hash.slice(0, 10)}`,
    amount: `${invoice.amount} ${tokenSymbol(invoice.token)}`,
    networkLabel: options.networkLabel,
    rows: [
      ['Invoice Hash', invoice.hash],
      ['Type', typeLabel(invoice.invoiceType)],
      ['Merchant', invoice.merchant],
      ['Payer', invoice.payer ?? '-'],
      ['Created', new Date(invoice.createdAt * 1000).toLocaleString()],
      ['Paid At', invoice.paidAt ? new Date(invoice.paidAt * 1000).toLocaleString() : '-'],
      ['Tx Hash', txHash || '-'],
      ['Memo', invoice.memo ?? '-'],
      ['Network', options.networkLabel],
      ['Explorer', explorer || '-'],
    ],
  };
}
