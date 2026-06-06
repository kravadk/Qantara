import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAccount } from 'wagmi';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  DollarSign,
  Receipt as ReceiptIcon,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { qieMainnet } from '../../config/wagmi';
import { useInvoices } from '../../hooks/useInvoices';
import {
  buildReceiptCsv,
  buildReceiptPdfModel,
} from '../../lib/receiptExport';
import {
  buildReceiptRecordExport,
  buildReceiptRecordShareText,
  getInvoice,
  getReceipt,
  getReceiptsStatus,
  hasMerchantAuth,
  isFailedWebhookDelivery,
  InvoiceStatus,
  listChainEvents,
  listReceipts,
  listWebhookDeliveries,
  receiptRecordFilename,
  receiptVerificationState,
  tokenSymbol,
  type ChainEventRecord,
  type QantaraInvoice,
  type ReceiptRecord,
  type ReceiptsStatus,
  type WebhookDeliveryRecord,
  typeLabel,
} from '../../lib/qantaraApi';

type Period = 'all' | '7d' | '30d' | 'custom';
type SortKey = 'newest' | 'oldest' | 'amount-desc' | 'amount-asc';
type ProofStep = { label: string; detail: string; state: 'good' | 'warn' | 'neutral' };

type LookupState = {
  query: string;
  receipt: ReceiptRecord | null;
  invoice: QantaraInvoice | null;
  error: string | null;
} | null;

export function PaymentProofs() {
  const { address } = useAccount();
  const { rawInvoices, isLoading, error: invoiceError, refetch } = useInvoices();
  const { addToast } = useToastStore();
  const explorerUrl = qieMainnet.blockExplorers.default.url;
  const merchantAuthReady = hasMerchantAuth();

  const [period, setPeriod] = useState<Period>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [search, setSearch] = useState('');
  const [receiptMap, setReceiptMap] = useState<Map<string, ReceiptRecord>>(new Map());
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptLoadError, setReceiptLoadError] = useState<string | null>(null);
  const [receiptsStatus, setReceiptsStatus] = useState<ReceiptsStatus | null>(null);
  const [lookupInput, setLookupInput] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupState, setLookupState] = useState<LookupState>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scopedPaidInvoices = useMemo(() => {
    const lower = address?.toLowerCase();
    return rawInvoices
      .filter((invoice) => invoice.status === InvoiceStatus.Paid)
      .filter((invoice) => (
        lower ? invoice.merchant.toLowerCase() === lower || invoice.payer?.toLowerCase() === lower : true
      ));
  }, [address, rawInvoices]);

  const paidInvoices = useMemo(() => {
    let filtered = scopedPaidInvoices;
    const now = Math.floor(Date.now() / 1000);

    if (period === '7d') filtered = filtered.filter((invoice) => (invoice.paidAt ?? invoice.createdAt) > now - 7 * 86400);
    else if (period === '30d') filtered = filtered.filter((invoice) => (invoice.paidAt ?? invoice.createdAt) > now - 30 * 86400);
    else if (period === 'custom') {
      if (customFrom) {
        const fromTs = Math.floor(new Date(customFrom).getTime() / 1000);
        filtered = filtered.filter((invoice) => (invoice.paidAt ?? invoice.createdAt) >= fromTs);
      }
      if (customTo) {
        const toTs = Math.floor(new Date(customTo).getTime() / 1000) + 86400;
        filtered = filtered.filter((invoice) => (invoice.paidAt ?? invoice.createdAt) <= toTs);
      }
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((invoice) =>
        invoice.hash.toLowerCase().includes(q) ||
        invoice.merchant.toLowerCase().includes(q) ||
        invoice.payer?.toLowerCase().includes(q) ||
        invoice.title?.toLowerCase().includes(q) ||
        receiptMap.get(invoice.hash.toLowerCase())?.receiptHash.toLowerCase().includes(q),
      );
    }

    const sorted = [...filtered];
    if (sort === 'newest') sorted.sort((a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt));
    else if (sort === 'oldest') sorted.sort((a, b) => (a.paidAt ?? a.createdAt) - (b.paidAt ?? b.createdAt));
    else if (sort === 'amount-desc') sorted.sort((a, b) => Number(b.amount) - Number(a.amount));
    else if (sort === 'amount-asc') sorted.sort((a, b) => Number(a.amount) - Number(b.amount));
    return sorted;
  }, [customFrom, customTo, period, receiptMap, scopedPaidInvoices, search, sort]);

  const summary = useMemo(() => {
    const totals = paidInvoices.reduce<Record<'QIE' | 'QUSDC', number>>((sum, invoice) => {
      sum[tokenSymbol(invoice.token)] += Number(invoice.amount || 0);
      return sum;
    }, { QIE: 0, QUSDC: 0 });
    const totalLabel = Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([token, value]) => `${value.toFixed(2)} ${token}`)
      .join(' / ') || '0';
    const avg = paidInvoices.length > 0
      ? paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0) / paidInvoices.length
      : 0;
    const largest = paidInvoices.reduce((max, invoice) => Math.max(max, Number(invoice.amount || 0)), 0);
    const receiptReady = paidInvoices.filter((invoice) => receiptMap.has(invoice.hash.toLowerCase())).length;
    return { total: totalLabel, avg: avg.toFixed(2), largest: largest.toFixed(2), count: paidInvoices.length, receiptReady };
  }, [paidInvoices, receiptMap]);

  const loadReceiptRecords = useCallback(async () => {
    if (!address) {
      setReceiptMap(new Map());
      setReceiptLoadError(null);
      setReceiptLoading(false);
      return;
    }

    setReceiptLoading(true);
    setReceiptLoadError(null);
    const next = new Map<string, ReceiptRecord>();
    let failures = 0;
    let errorText: string | null = null;

    const publicResults = await Promise.allSettled(scopedPaidInvoices.map(async (invoice) => {
      const receipt = await getReceipt(invoice.hash);
      return { invoiceHash: invoice.hash, receipt };
    }));

    for (const result of publicResults) {
      if (result.status === 'rejected') {
        failures += 1;
        continue;
      }
      if (result.value.receipt) next.set(result.value.invoiceHash.toLowerCase(), result.value.receipt);
    }

    if (merchantAuthReady) {
      try {
        const merchantReceipts = await listReceipts({ merchant: address, limit: 200 });
        for (const receipt of merchantReceipts.receipts) next.set(receipt.invoiceHash.toLowerCase(), receipt);
      } catch (err) {
        failures += 1;
        errorText = err instanceof Error ? err.message : 'Authenticated receipt list unavailable';
      }
    }

    setReceiptLoadError(errorText ?? (failures > 0
      ? `Receipt API lookup failed for ${failures} request${failures === 1 ? '' : 's'}. Invoice paid state still comes from the backend invoice list.`
      : null));
    setReceiptMap(next);
    setReceiptLoading(false);
  }, [address, merchantAuthReady, scopedPaidInvoices]);

  useEffect(() => {
    void loadReceiptRecords();
  }, [loadReceiptRecords]);

  const loadReceiptsStatus = useCallback(async () => {
    try {
      setReceiptsStatus(await getReceiptsStatus());
    } catch {
      setReceiptsStatus(null);
    }
  }, []);

  useEffect(() => {
    void loadReceiptsStatus();
  }, [loadReceiptsStatus]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast('success', `${label} copied`);
  };

  const exportCsv = () => {
    if (paidInvoices.length === 0) {
      addToast('info', 'Nothing to export');
      return;
    }
    const csv = buildReceiptCsv(paidInvoices);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qantara-paid-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', `Exported ${paidInvoices.length} paid invoices`);
  };

  const downloadReceiptJson = (receipt: ReceiptRecord) => {
    const payload = buildReceiptRecordExport(receipt, {
      explorerUrl,
      networkLabel: `QIE Mainnet - chain ${qieMainnet.id}`,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receiptRecordFilename(receipt);
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Receipt record downloaded');
  };

  const shareReceipt = async (receipt: ReceiptRecord) => {
    const text = buildReceiptRecordShareText(receipt, {
      explorerUrl,
      networkLabel: `QIE Mainnet - chain ${qieMainnet.id}`,
    });
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Qantara receipt', text });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    navigator.clipboard.writeText(text);
    addToast('success', 'Receipt text copied');
  };

  const exportSinglePdf = async (inv: QantaraInvoice) => {
    const model = buildReceiptPdfModel(inv, {
      explorerUrl,
      networkLabel: `QIE Mainnet - chain ${qieMainnet.id}`,
    });
    const node = renderReceiptNode(model);

    try {
      document.body.appendChild(node);
      const canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale: 2,
      });
      const image = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = Math.min((canvas.height * imageWidth) / canvas.width, pageHeight - margin * 2);

      pdf.addImage(image, 'PNG', margin, margin, imageWidth, imageHeight);
      pdf.save(model.filename);
      addToast('success', 'Payment proof PDF downloaded');
    } catch (err: any) {
      addToast('error', err?.message?.slice(0, 80) || 'PDF export failed');
    } finally {
      node.remove();
    }
  };

  const lookupProof = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = lookupInput.trim();
    if (!query) {
      addToast('warning', 'Enter an invoice or receipt hash');
      return;
    }
    setLookupLoading(true);
    setLookupState(null);
    const [receiptResult, invoiceResult] = await Promise.allSettled([
      getReceipt(query),
      getInvoice(query),
    ]);
    const receipt = receiptResult.status === 'fulfilled' ? receiptResult.value : null;
    const invoice = invoiceResult.status === 'fulfilled' ? invoiceResult.value : null;
    const errors = [receiptResult, invoiceResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : 'Backend request failed');
    setLookupState({
      query,
      receipt,
      invoice,
      error: errors.length === 2 ? errors.join(' / ') : null,
    });
    setLookupLoading(false);
  };

  const refreshAll = async () => {
    await refetch();
    await Promise.all([loadReceiptRecords(), loadReceiptsStatus()]);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Receipts</h1>
          <p className="mt-1 max-w-3xl text-text-secondary">
            Backend verified paid invoices with persisted receipt records when issued. Receipt hash and transaction hash come from the receipt API or backend invoice state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-2" loading={isLoading || receiptLoading} onClick={() => void refreshAll()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {(invoiceError || receiptLoadError) && (
        <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/5 p-4 text-sm text-yellow-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
            <div>
              {invoiceError && <p>Invoice API error: {invoiceError}</p>}
              {receiptLoadError && <p>Receipt API notice: {receiptLoadError}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={ReceiptIcon}
          label="Paid invoices"
          value={String(summary.count)}
          sub={period === 'all' ? 'current wallet' : period === '7d' ? 'last 7 days' : period === '30d' ? 'last 30 days' : 'custom range'}
        />
        <StatCard
          icon={ShieldCheck}
          label="Receipt records"
          value={String(summary.receiptReady)}
          sub={receiptLoading ? 'checking API' : 'persisted records'}
          highlight={summary.receiptReady > 0}
        />
        <StatCard
          icon={DollarSign}
          label="Verified volume"
          value={summary.total}
          sub="by token"
        />
        <StatCard
          icon={TrendingUp}
          label="Largest invoice"
          value={summary.largest}
          sub={summary.count > 0 ? `avg ${summary.avg}` : 'no paid invoices'}
        />
      </div>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Receipt verification source</h2>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Receipts are created after backend RPC/indexer verification. Optional on-chain anchoring is shown only when a registry is configured.
            </p>
          </div>
          <div className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${receiptsStatus?.verification.onChainAnchor.enabled ? 'bg-primary/15 text-primary' : 'bg-surface-2 text-text-muted'}`}>
            {receiptsStatus?.verification.onChainAnchor.enabled ? 'registry configured' : 'backend receipt only'}
          </div>
        </div>
        <div className="mt-4 grid gap-2 text-xs md:grid-cols-3">
          <InfoLine label="Issued receipts" value={receiptsStatus ? `${receiptsStatus.receipts.issued} persisted` : 'status unavailable'} />
          <InfoLine label="Anchor status" value={receiptsStatus?.verification.onChainAnchor.status ?? 'not reported'} />
          <InfoLine label="Registry" value={receiptsStatus?.verification.onChainAnchor.registryAddress ?? 'not configured'} />
        </div>
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Proof lookup</h2>
            <p className="text-xs text-text-muted">Check a specific invoice hash against backend invoice and receipt endpoints.</p>
          </div>
          <div className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${merchantAuthReady ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'}`}>
            {merchantAuthReady ? 'merchant session ready' : 'public lookup only'}
          </div>
        </div>
        <form onSubmit={(event) => void lookupProof(event)} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Invoice or receipt hash"
              value={lookupInput}
              onChange={(event) => setLookupInput(event.target.value)}
              className="w-full rounded-lg border border-border-default bg-surface-2 py-2 pl-9 pr-3 text-sm text-white placeholder:text-text-muted focus:border-primary/40 focus:outline-none"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" className="gap-2" loading={lookupLoading}>
            <FileCheck className="h-4 w-4" /> Verify
          </Button>
        </form>
        {lookupState && (
          <LookupResult
            state={lookupState}
            explorerUrl={explorerUrl}
            onCopy={handleCopy}
            onDownloadReceipt={downloadReceiptJson}
          />
        )}
      </section>

      <div className="space-y-3 rounded-2xl border border-border-default bg-surface-1 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Filter className="h-3.5 w-3.5" /> Period
          </div>
          {(['all', '7d', '30d', 'custom'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                period === p
                  ? 'border-primary/30 bg-primary/15 text-primary'
                  : 'border-border-default bg-surface-2 text-text-secondary hover:border-primary/30'
              }`}
            >
              {p === 'all' ? 'All time' : p === '7d' ? 'Last 7 days' : p === '30d' ? 'Last 30 days' : 'Custom'}
            </button>
          ))}

          {period === 'custom' && (
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="rounded border border-border-default bg-surface-2 px-2 py-1 text-white"
              />
              <span className="text-text-muted">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="rounded border border-border-default bg-surface-2 px-2 py-1 text-white"
              />
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
            <ArrowUpDown className="h-3.5 w-3.5" />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="rounded border border-border-default bg-surface-2 px-2 py-1 text-xs text-white focus:outline-none"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount-desc">Amount desc</option>
              <option value="amount-asc">Amount asc</option>
            </select>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Filter by invoice, receipt, address, or title"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-border-default bg-surface-2 py-2 pl-9 pr-3 text-sm text-white placeholder:text-text-muted focus:border-primary/40 focus:outline-none"
          />
        </div>
      </div>

      {paidInvoices.length === 0 ? (
        <div className="space-y-3 py-20 text-center">
          <FileCheck className="mx-auto h-12 w-12 text-text-muted" />
          <h2 className="text-lg font-bold text-white">No paid invoices in this view</h2>
          <p className="mx-auto max-w-md text-sm text-text-secondary">
            {period !== 'all' || search
              ? 'Change the filters or search term to inspect other backend invoice records.'
              : 'Verified paid invoices for the connected wallet will appear here after the backend confirms settlement.'}
          </p>
        </div>
      ) : (
        <div ref={listRef} className="space-y-3">
          {paidInvoices.map((invoice) => (
            <ReceiptRow
              key={invoice.hash}
              invoice={invoice}
              receipt={receiptMap.get(invoice.hash.toLowerCase()) ?? null}
              userAddress={address}
              explorerUrl={explorerUrl}
              onCopy={handleCopy}
              onExportPdf={exportSinglePdf}
              onDownloadReceipt={downloadReceiptJson}
              onShareReceipt={(receipt) => void shareReceipt(receipt)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  highlight = false,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border bg-surface-1 p-4 ${highlight ? 'border-primary/30' : 'border-border-default'}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${highlight ? 'text-primary' : 'text-text-muted'}`} />
        <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      </div>
      <div className={`text-2xl font-bold tracking-tight ${highlight ? 'text-primary' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-[10px] text-text-muted">{sub}</div>
    </motion.div>
  );
}

function LookupResult({
  state,
  explorerUrl,
  onCopy,
  onDownloadReceipt,
}: {
  state: NonNullable<LookupState>;
  explorerUrl: string;
  onCopy: (text: string, label: string) => void;
  onDownloadReceipt: (receipt: ReceiptRecord) => void;
}) {
  const verification = receiptVerificationState(state.invoice, state.receipt);
  const txHash = state.receipt?.txHash ?? state.invoice?.paidTxHash;
  const found = Boolean(state.receipt || state.invoice);

  return (
    <div className={`mt-4 rounded-xl border p-4 ${state.error ? 'border-red-500/25 bg-red-500/5' : found ? 'border-border-default bg-surface-2' : 'border-yellow-500/25 bg-yellow-500/5'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TrustBadge label={verification.label} tone={verification.tone} />
            <code className="truncate text-xs text-text-muted">{state.query}</code>
          </div>
          <p className="text-sm text-text-secondary">
            {state.error
              ? `Backend lookup failed: ${state.error}`
              : found
                ? verification.detail
                : 'No backend invoice or receipt record was returned for this hash.'}
          </p>
          {state.receipt && (
            <div className="grid gap-2 text-xs md:grid-cols-2">
              <InfoLine label="Receipt" value={state.receipt.receiptHash} />
              <InfoLine label="Invoice" value={state.receipt.invoiceHash} />
              <InfoLine label="Tx" value={state.receipt.txHash} />
              <InfoLine label="Issued" value={new Date(state.receipt.issuedAt * 1000).toLocaleString()} />
            </div>
          )}
          {!state.receipt && state.invoice && (
            <div className="grid gap-2 text-xs md:grid-cols-2">
              <InfoLine label="Invoice" value={state.invoice.hash} />
              <InfoLine label="Status" value={state.invoice.status === InvoiceStatus.Paid ? 'Paid' : 'Not paid'} />
              <InfoLine label="Amount" value={`${state.invoice.amount} ${tokenSymbol(state.invoice.token)}`} />
              <InfoLine label="Tx" value={state.invoice.paidTxHash ?? 'not reported'} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {state.receipt && (
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => onDownloadReceipt(state.receipt!)}>
              <Download className="h-3.5 w-3.5" /> JSON
            </Button>
          )}
          {txHash && (
            <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" /> Explorer
              </Button>
            </a>
          )}
          {(state.receipt?.receiptHash || state.invoice?.hash) && (
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => onCopy(state.receipt?.receiptHash ?? state.invoice!.hash, 'Proof hash')}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({
  invoice,
  receipt,
  userAddress,
  explorerUrl,
  onCopy,
  onExportPdf,
  onDownloadReceipt,
  onShareReceipt,
}: {
  invoice: QantaraInvoice;
  receipt: ReceiptRecord | null;
  userAddress?: string;
  explorerUrl: string;
  onCopy: (text: string, label: string) => void;
  onExportPdf: (invoice: QantaraInvoice) => void;
  onDownloadReceipt: (receipt: ReceiptRecord) => void;
  onShareReceipt: (receipt: ReceiptRecord) => void;
}) {
  const isMerchant = userAddress?.toLowerCase() === invoice.merchant.toLowerCase();
  const counterparty = isMerchant ? invoice.payer : invoice.merchant;
  const symbol = tokenSymbol(invoice.token);
  const verification = receiptVerificationState(invoice, receipt);
  const txHash = receipt?.txHash ?? invoice.paidTxHash;
  const [chainEvents, setChainEvents] = useState<ChainEventRecord[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [proofLogError, setProofLogError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!hasMerchantAuth()) {
      setChainEvents([]);
      setWebhookDeliveries([]);
      setProofLogError(null);
      return;
    }
    const loadProofLogs = async () => {
      const [chainResult, webhookResult] = await Promise.allSettled([
        listChainEvents({ invoiceHash: invoice.hash, limit: 20 }),
        listWebhookDeliveries({ invoiceHash: invoice.hash, limit: 20 }),
      ]);
      if (!active) return;
      if (chainResult.status === 'fulfilled') setChainEvents(chainResult.value.events);
      else setChainEvents([]);
      if (webhookResult.status === 'fulfilled') setWebhookDeliveries(webhookResult.value.deliveries);
      else setWebhookDeliveries([]);
      const errors = [chainResult, webhookResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : 'proof log unavailable');
      setProofLogError(errors.length > 0 ? errors.join(' / ') : null);
    };
    void loadProofLogs();
    return () => {
      active = false;
    };
  }, [invoice.hash]);

  const paidChainEvent = chainEvents.find((event) => event.eventType === 'InvoicePaid' || event.eventType === 'invoice.paid');
  const failedWebhook = webhookDeliveries.find(isFailedWebhookDelivery);
  const successfulWebhook = webhookDeliveries.find((delivery) => delivery.status >= 200 && delivery.status < 300);
  const telegramDelivery = webhookDeliveries.find((delivery) => {
    const target = delivery.targetUrl?.toLowerCase() ?? '';
    const payload = JSON.stringify(delivery.eventPayload ?? {}).toLowerCase();
    return target.includes('telegram') || target.includes('bot') || payload.includes('telegram');
  });
  const proofSteps: ProofStep[] = [
    {
      label: 'Create tx',
      detail: invoice.metadata?.chain_tx_hash
        ? `${String(invoice.metadata.chain_tx_hash).slice(0, 10)}...${String(invoice.metadata.chain_tx_hash).slice(-6)}`
        : 'Backend invoice record; create tx not attached',
      state: invoice.metadata?.chain_tx_hash ? 'good' : 'neutral',
    },
    {
      label: 'Payment tx',
      detail: txHash ? `${txHash.slice(0, 10)}...${txHash.slice(-6)}` : 'Payment transaction not reported',
      state: txHash ? 'good' : 'warn',
    },
    {
      label: 'Indexed event',
      detail: paidChainEvent ? `Block ${paidChainEvent.blockNumber}` : hasMerchantAuth() ? 'No indexed payment event in scoped logs' : 'Merchant sign-in required for chain log',
      state: paidChainEvent ? 'good' : 'neutral',
    },
    {
      label: 'RPC verification',
      detail: invoice.status === InvoiceStatus.Paid && txHash ? 'Backend accepted paid state after RPC/indexer proof' : 'Waiting for verified paid state',
      state: invoice.status === InvoiceStatus.Paid && txHash ? 'good' : 'warn',
    },
    {
      label: 'Receipt hash',
      detail: receipt ? receipt.receiptHash.slice(0, 18) + '...' + receipt.receiptHash.slice(-8) : 'Receipt not issued yet',
      state: receipt ? 'good' : 'warn',
    },
    {
      label: 'Webhook',
      detail: failedWebhook
        ? failedWebhook.lastError || `Failed with ${failedWebhook.status || 'network'}`
        : successfulWebhook
          ? `${successfulWebhook.eventType} delivered`
          : hasMerchantAuth()
            ? 'No delivery for this invoice'
            : 'Merchant sign-in required for delivery log',
      state: failedWebhook ? 'warn' : successfulWebhook ? 'good' : 'neutral',
    },
    {
      label: 'Telegram',
      detail: telegramDelivery
        ? telegramDelivery.status >= 200 && telegramDelivery.status < 300
          ? 'Telegram/bot notification delivered'
          : telegramDelivery.lastError || 'Telegram/bot delivery failed'
        : hasMerchantAuth()
          ? 'No Telegram/bot delivery recorded'
          : 'Merchant sign-in required for notification proof',
      state: telegramDelivery ? (telegramDelivery.status >= 200 && telegramDelivery.status < 300 ? 'good' : 'warn') : 'neutral',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border-default bg-surface-1 p-5 transition-colors hover:border-primary/30"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
              {typeLabel(invoice.invoiceType)}
            </span>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
              isMerchant ? 'border-primary/30 bg-primary/10 text-primary' : 'border-blue-500/30 bg-blue-500/10 text-blue-400'
            }`}>
              {isMerchant ? 'received' : 'sent'}
            </span>
            <TrustBadge label={verification.label} tone={verification.tone} />
            <span className="ml-auto text-[10px] text-text-muted">
              {invoice.paidAt ? new Date(invoice.paidAt * 1000).toLocaleString() : 'paid time not reported'}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">
                {invoice.title || invoice.memo || `Invoice ${invoice.hash.slice(0, 10)}`}
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-text-muted">
                {invoice.hash.slice(0, 16)}...{invoice.hash.slice(-8)}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-xl font-bold tracking-tight ${isMerchant ? 'text-primary' : 'text-white'}`}>
                {isMerchant ? '+' : '-'}{invoice.amount}
              </div>
              <div className="text-[10px] uppercase text-text-muted">{symbol}</div>
            </div>
          </div>

          <div className="grid gap-2 text-xs md:grid-cols-2">
            <InfoLine label={isMerchant ? 'From' : 'To'} value={counterparty ?? 'not reported'} />
            <InfoLine label="Receipt source" value={verification.detail} />
            {receipt && <InfoLine label="Receipt hash" value={receipt.receiptHash} />}
            {txHash && <InfoLine label="Tx hash" value={txHash} />}
          </div>

          <ProofTimeline steps={proofSteps} />
          {proofLogError && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-200">
              Proof log notice: {proofLogError}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            onClick={() => onCopy(`${window.location.origin}/pay/${invoice.hash}`, 'Invoice link')}
            className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted transition-colors hover:border-primary/30 hover:text-primary"
            title="Copy invoice link"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {txHash && (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted transition-colors hover:border-primary/30 hover:text-primary"
              title="View transaction"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {receipt ? (
            <>
              <button
                onClick={() => onDownloadReceipt(receipt)}
                className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted transition-colors hover:border-primary/30 hover:text-primary"
                title="Download receipt record"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onShareReceipt(receipt)}
                className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted transition-colors hover:border-primary/30 hover:text-primary"
                title="Copy receipt share text"
              >
                <FileCheck className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => onExportPdf(invoice)}
              className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted transition-colors hover:border-primary/30 hover:text-primary"
              title="Download payment proof PDF"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ProofTimeline({ steps }: { steps: ProofStep[] }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-2 p-3">
      <div className="mb-3 text-[10px] uppercase tracking-widest text-text-muted">Proof chain</div>
      <div className="grid gap-2 md:grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.state === 'good' ? CheckCircle : step.state === 'warn' ? AlertTriangle : Clock;
          const tone = step.state === 'good'
            ? 'border-primary/25 bg-primary/8 text-primary'
            : step.state === 'warn'
              ? 'border-yellow-400/25 bg-yellow-400/8 text-yellow-200'
              : 'border-border-default bg-surface-1 text-text-muted';
          return (
            <div key={step.label} className={`rounded-xl border p-3 ${tone}`}>
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-widest">{index + 1}. {step.label}</span>
              </div>
              <div className="mt-1 truncate text-xs text-text-secondary">{step.detail}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrustBadge({ label, tone }: { label: string; tone: 'good' | 'warn' | 'neutral' }) {
  const Icon = tone === 'good' ? CheckCircle : tone === 'warn' ? AlertTriangle : Clock;
  const cls = tone === 'good'
    ? 'border-primary/30 bg-primary/10 text-primary'
    : tone === 'warn'
      ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300'
      : 'border-border-default bg-surface-2 text-text-muted';
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${cls}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-default bg-surface-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-text-secondary">{value}</div>
    </div>
  );
}

function renderReceiptNode(model: ReturnType<typeof buildReceiptPdfModel>) {
  const node = document.createElement('div');
  Object.assign(node.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '720px',
    padding: '40px',
    background: '#ffffff',
    color: '#111827',
    fontFamily: 'Arial, sans-serif',
    border: '1px solid #e5e7eb',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '24px',
    alignItems: 'flex-start',
  });

  const titleGroup = document.createElement('div');
  const eyebrow = receiptText('Qantara Payment Proof', {
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: '#64748b',
  });
  const title = document.createElement('h1');
  title.textContent = model.title;
  Object.assign(title.style, {
    margin: '10px 0 0',
    fontSize: '30px',
    lineHeight: '1.1',
    color: '#0f172a',
  });
  const network = receiptText(model.networkLabel, {
    marginTop: '8px',
    fontSize: '13px',
    color: '#64748b',
  });
  titleGroup.append(eyebrow, title, network);

  const amountGroup = document.createElement('div');
  amountGroup.style.textAlign = 'right';
  const amountLabel = receiptText('Amount', {
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: '#64748b',
  });
  const amount = receiptText(model.amount, {
    marginTop: '8px',
    fontSize: '28px',
    fontWeight: '800',
    color: '#0f766e',
  });
  amountGroup.append(amountLabel, amount);
  header.append(titleGroup, amountGroup);

  const rows = document.createElement('div');
  Object.assign(rows.style, {
    marginTop: '32px',
    borderTop: '1px solid #e5e7eb',
  });
  for (const [label, value] of model.rows) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '140px 1fr',
      gap: '16px',
      padding: '14px 0',
      borderBottom: '1px solid #e5e7eb',
    });
    row.append(
      receiptText(label, {
        fontSize: '12px',
        fontWeight: '700',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#64748b',
      }),
      receiptText(value, {
        fontSize: '13px',
        lineHeight: '1.45',
        color: '#111827',
        wordBreak: 'break-all',
      }),
    );
    rows.appendChild(row);
  }

  const footer = receiptText(
    'This proof was generated from Qantara backend payment data. Verify settlement with the transaction hash on the QIE explorer.',
    {
      marginTop: '28px',
      fontSize: '11px',
      lineHeight: '1.6',
      color: '#64748b',
    },
  );

  node.append(header, rows, footer);
  return node;
}

function receiptText(value: string, style: Partial<CSSStyleDeclaration>) {
  const node = document.createElement('div');
  node.textContent = value;
  Object.assign(node.style, style);
  return node;
}
