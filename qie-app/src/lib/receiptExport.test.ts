import { describe, expect, it } from 'vitest';
import {
  buildReceiptCsv,
  buildReceiptPdfModel,
  buildReceiptPdfFilename,
} from './receiptExport';

const paidInvoice = {
  hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  merchant: '0x1111111111111111111111111111111111111111',
  payer: '0x2222222222222222222222222222222222222222',
  token: '0x0000000000000000000000000000000000000000',
  amount: '42.50',
  invoiceType: 0,
  status: 1,
  createdAt: 1_700_000_000,
  expiresAt: 0,
  metadataHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  paidAt: 1_700_000_300,
  paidTxHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  title: 'Consulting invoice',
  memo: 'Tax, strategy',
} as const;

describe('receipt export helpers', () => {
  it('builds tax-ready CSV with required paid invoice columns', () => {
    const csv = buildReceiptCsv([paidInvoice]);

    expect(csv.split('\n')[0]).toBe('"hash","invoiceType","amount","token","merchant","payer","createdAt","paidAt","txHash","memo"');
    expect(csv).toContain('"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"');
    expect(csv).toContain('"Standard"');
    expect(csv).toContain('"QIE"');
    expect(csv).toContain('"Tax, strategy"');
  });

  it('builds a stable PDF receipt model with explorer link', () => {
    const model = buildReceiptPdfModel(paidInvoice, {
      explorerUrl: 'https://mainnet.qie.digital',
      networkLabel: 'QIE Mainnet - chain 1990',
    });

    expect(model.filename).toBe('receipt-0x12345678.pdf');
    expect(model.amount).toBe('42.50 QIE');
    expect(model.title).toBe('Consulting invoice');
    expect(model.rows).toContainEqual(['Tx Hash', paidInvoice.paidTxHash]);
    expect(model.rows).toContainEqual(['Explorer', `https://mainnet.qie.digital/tx/${paidInvoice.paidTxHash}`]);
  });

  it('uses a short hash in the generated PDF filename', () => {
    expect(buildReceiptPdfFilename(paidInvoice.hash)).toBe('receipt-0x12345678.pdf');
  });
});
