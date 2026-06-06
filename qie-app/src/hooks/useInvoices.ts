import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { listInvoices, tokenSymbol, type QantaraInvoice } from '../lib/qantaraApi';
import type { Invoice } from '../store/useInvoiceStore';

const TYPE_MAP: Record<number, Invoice['type']> = {
  0: 'standard',
  1: 'multi-pay',
  2: 'recurring',
  3: 'vesting',
  4: 'standard',
};

const STATUS_MAP: Record<number, Invoice['status']> = {
  0: 'open',
  1: 'settled',
  2: 'cancelled',
  3: 'cancelled',
  4: 'paused',
};

export function toLegacyInvoice(invoice: QantaraInvoice): Invoice {
  return {
    id: invoice.hash,
    hash: invoice.hash,
    type: TYPE_MAP[invoice.invoiceType] ?? 'standard',
    status: STATUS_MAP[invoice.status] ?? 'open',
    createdAt: new Date(invoice.createdAt * 1000).toISOString(),
    amount: invoice.amount,
    token: tokenSymbol(invoice.token),
    seller: invoice.merchant,
    recipient: invoice.payer ?? '',
    memo: invoice.memo ?? '',
    blockNumber: invoice.createdAt,
    creator: invoice.merchant,
    timestamp: invoice.createdAt,
    deadline: invoice.expiresAt || undefined,
  };
}

export function useInvoices() {
  const { address } = useAccount();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [rawInvoices, setRawInvoices] = useState<QantaraInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    if (!address) {
      setInvoices([]);
      setRawInvoices([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [byMerchant, byPayer] = await Promise.all([
        listInvoices({ merchant: address }),
        listInvoices({ payer: address }),
      ]);
      const merged = new Map<string, QantaraInvoice>();
      for (const invoice of [...byMerchant.invoices, ...byPayer.invoices]) {
        merged.set(invoice.hash.toLowerCase(), invoice);
      }
      const records = Array.from(merged.values());
      setRawInvoices(records);
      setInvoices(records.map(toLegacyInvoice));
    } catch (err: any) {
      setError(err?.message ?? 'Could not load invoices');
      setInvoices([]);
      setRawInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void fetchInvoices();
    const interval = window.setInterval(() => void fetchInvoices(), 5000);
    return () => window.clearInterval(interval);
  }, [fetchInvoices]);

  return { invoices, rawInvoices, isLoading, error, refetch: fetchInvoices };
}
