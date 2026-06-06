import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, Copy, ExternalLink, Filter, Search, Trophy, X, Share2,
  ReceiptText, Users, WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { qieMainnet } from '../../config/wagmi';
import {
  getExplorerActivity,
  getExplorerMerchants,
  getExplorerStats,
  type ExplorerActivityRecord,
  type ExplorerMerchantRecord,
  type ExplorerStats,
} from '../../lib/api/explorerApi';
import {
  getInvoice,
  InvoiceStatus,
  InvoiceType,
  listInvoices,
  statusLabel,
  tokenSymbol,
  type QantaraInvoice,
  typeLabel,
} from '../../lib/api/invoicesApi';

type FilterKey = 'all' | 'created' | 'paid' | 'cancelled' | 'standard' | 'donation' | 'multi';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'created', label: 'Created' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'standard', label: 'Standard' },
  { key: 'donation', label: 'Donation' },
  { key: 'multi', label: 'Multi-payer' },
];

export function Explorer() {
  const { addToast } = useToastStore();
  const [invoices, setInvoices] = useState<QantaraInvoice[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<QantaraInvoice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [network, setNetwork] = useState<ExplorerStats | null>(null);
  const [activity, setActivity] = useState<ExplorerActivityRecord[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [merchants, setMerchants] = useState<ExplorerMerchantRecord[]>([]);
  const [merchantsError, setMerchantsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadNetwork = async () => {
      try {
        const [stats, globalActivity, directory] = await Promise.all([
          getExplorerStats(),
          getExplorerActivity({ limit: 50 }),
          getExplorerMerchants({ limit: 12 }),
        ]);
        if (!active) return;
        setNetwork(stats);
        setActivity(globalActivity.activity);
        setMerchants(directory.merchants);
      } catch (err) {
        if (!active) return;
        setActivityError(err instanceof Error ? err.message : 'Explorer activity unavailable');
        setMerchantsError(err instanceof Error ? err.message : 'Merchant directory unavailable');
      }
    };
    void loadNetwork();
    return () => { active = false; };
  }, []);

  const refreshNetwork = async () => {
    setActivityLoading(true);
    setActivityError(null);
    setMerchantsError(null);
    try {
      const [stats, globalActivity, directory] = await Promise.all([
        getExplorerStats(),
        getExplorerActivity({ limit: 50 }),
        getExplorerMerchants({ limit: 12 }),
      ]);
      setNetwork(stats);
      setActivity(globalActivity.activity);
      setMerchants(directory.merchants);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : 'Explorer activity unavailable');
      setMerchantsError(err instanceof Error ? err.message : 'Merchant directory unavailable');
    } finally {
      setActivityLoading(false);
    }
  };

  const refresh = async () => {
    const q = search.trim();
    setLoadError(null);
    if (!q) {
      setInvoices([]);
      return;
    }
    setIsLoading(true);
    try {
      if (/^0x[a-fA-F0-9]{64}$/.test(q)) {
        const invoice = await getInvoice(q);
        setInvoices(invoice ? [invoice] : []);
        return;
      }
      if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
        const [byMerchant, byPayer] = await Promise.all([
          listInvoices({ merchant: q as `0x${string}` }),
          listInvoices({ payer: q as `0x${string}` }),
        ]);
        const merged = new Map<string, QantaraInvoice>();
        for (const invoice of [...byMerchant.invoices, ...byPayer.invoices]) merged.set(invoice.hash.toLowerCase(), invoice);
        setInvoices(Array.from(merged.values()));
        return;
      }
      setInvoices([]);
      setLoadError('Enter a full invoice hash, merchant address, or payer address.');
    } catch (err: any) {
      setLoadError(err?.message ?? 'Could not load invoices');
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      const matchesSearch = !q ||
        inv.hash.toLowerCase().includes(q) ||
        inv.merchant.toLowerCase().includes(q) ||
        inv.payer?.toLowerCase().includes(q) ||
        inv.memo?.toLowerCase().includes(q) ||
        inv.title?.toLowerCase().includes(q);

      const matchesFilter =
        filter === 'all' ||
        (filter === 'created' && inv.status === InvoiceStatus.Created) ||
        (filter === 'paid' && inv.status === InvoiceStatus.Paid) ||
        (filter === 'cancelled' && inv.status === InvoiceStatus.Cancelled) ||
        (filter === 'standard' && inv.invoiceType === InvoiceType.Standard) ||
        (filter === 'donation' && inv.invoiceType === InvoiceType.Donation) ||
        (filter === 'multi' && inv.invoiceType === InvoiceType.MultiPay);

      return matchesSearch && matchesFilter;
    });
  }, [filter, invoices, search]);

  const stats = useMemo(() => {
    const paid = invoices.filter(i => i.status === InvoiceStatus.Paid);
    const volume = paid.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const merchants = new Set(invoices.map(i => i.merchant.toLowerCase())).size;
    const since24h = Math.floor(Date.now() / 1000) - 86400;
    const paid24h = paid.filter(i => (i.paidAt || i.createdAt) >= since24h).length;
    return { total: invoices.length, paid: paid.length, volume, merchants, paid24h };
  }, [invoices]);

  const activityLeaderboard = useMemo(() => {
    const map = new Map<string, { merchant: string; count: number; volume: number; tokens: Set<string> }>();
    for (const item of activity) {
      if (!item.merchant) continue;
      const key = item.merchant.toLowerCase();
      const current = map.get(key) || { merchant: item.merchant, count: 0, volume: 0, tokens: new Set<string>() };
      current.count += 1;
      current.volume += Number(item.amount || 0);
      if (item.tokenSymbol) current.tokens.add(item.tokenSymbol);
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => b.volume - a.volume || b.count - a.count).slice(0, 5);
  }, [activity]);

  const searchLeaderboard = useMemo(() => {
    const map = new Map<string, { merchant: string; count: number; volume: number }>();
    for (const inv of invoices) {
      const key = inv.merchant.toLowerCase();
      const item = map.get(key) || { merchant: inv.merchant, count: 0, volume: 0 };
      item.count += 1;
      if (inv.status === InvoiceStatus.Paid) item.volume += Number(inv.amount || 0);
      map.set(key, item);
    }
    return Array.from(map.values()).sort((a, b) => b.volume - a.volume || b.count - a.count).slice(0, 5);
  }, [invoices]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast('success', `${label} copied`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Explorer</h1>
          <p className="text-text-secondary mt-1">Search public invoice records by exact invoice hash, merchant, or payer address.</p>
        </div>
        <Button variant="secondary" className="gap-2" loading={activityLoading} onClick={() => { void refresh(); void refreshNetwork(); }}>
          <Activity className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {network && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-text-muted">Network (all merchants)</p>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <Stat icon={WalletCards} label="Paid invoices" value={String(network.paidCount)} accent />
            <Stat icon={Users} label="Active merchants" value={String(network.activeMerchants)} />
            <Stat icon={ReceiptText} label="Receipts" value={String(network.receiptsCount)} />
            <Stat icon={Activity} label="24h paid" value={String(network.last24hPaidCount)} />
            <Stat icon={Activity} label="Volume" value={network.volume.length ? network.volume.map((v) => `${v.paidVolume} ${tokenSymbol(v.token)}`).join(' · ') : '0'} />
          </div>
        </div>
      )}

      {search.trim() && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-text-muted">Current search result</p>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <Stat icon={ReceiptText} label="Invoices" value={String(stats.total)} />
            <Stat icon={WalletCards} label="Paid" value={String(stats.paid)} />
            <Stat icon={Activity} label="Volume" value={stats.volume.toFixed(2)} accent />
            <Stat icon={Users} label="Merchants" value={String(stats.merchants)} />
            <Stat icon={Activity} label="24h paid" value={String(stats.paid24h)} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <div className="bg-surface-1 border border-border-default rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Enter invoice hash, merchant, or payer address"
                className="w-full h-12 pl-11 pr-4 bg-surface-2 border border-border-default rounded-xl text-sm text-white placeholder:text-text-muted focus:outline-none focus:border-primary/40"
              />
            </div>
            {loadError && <div className="text-xs text-yellow-300">{loadError}</div>}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Filter className="w-4 h-4 text-text-muted shrink-0" />
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${
                    filter === f.key
                      ? 'bg-primary text-black border-primary'
                      : 'bg-surface-2 text-text-secondary border-border-default hover:border-primary/40'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="bg-surface-1 border border-border-default rounded-2xl p-12 text-center">
              <Activity className="w-10 h-10 text-primary mx-auto mb-3 animate-pulse" />
              <h2 className="text-lg font-bold text-white">Loading invoice records</h2>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-surface-1 border border-border-default rounded-2xl p-12 text-center">
              <Search className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <h2 className="text-lg font-bold text-white">No invoices found</h2>
              <p className="text-sm text-text-secondary mt-1">Search with an exact invoice hash, merchant address, or payer address.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filtered.map(inv => (
                <InvoiceCard key={inv.hash} invoice={inv} onOpen={() => setSelected(inv)} onCopy={copy} />
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <PanelTitle icon={Trophy} title="Active Merchants" />
          <div className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
            {activityLeaderboard.length === 0 ? (
              <div className="p-5 text-sm text-text-muted">{activityError || 'No backend activity yet.'}</div>
            ) : activityLeaderboard.map((m, index) => (
              <div key={m.merchant} className="p-4 border-b border-border-default last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-text-muted">#{index + 1}</div>
                    <code className="text-sm text-white truncate block">{short(m.merchant)}</code>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-primary">{m.volume.toFixed(2)}</div>
                    <div className="text-[10px] text-text-muted">{m.count} activity item{m.count === 1 ? '' : 's'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <PanelTitle icon={Users} title="Verified Directory" />
          <div className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
            {merchants.length === 0 ? (
              <div className="p-5 text-sm text-text-muted">{merchantsError || 'No public merchants opted in yet.'}</div>
            ) : merchants.slice(0, 6).map((merchant) => (
              <a
                key={merchant.merchant}
                href={`/profile/${merchant.merchant}`}
                className="block p-4 border-b border-border-default last:border-b-0 hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">{merchant.displayName || short(merchant.merchant)}</div>
                    <div className="truncate text-[10px] text-text-muted">{merchant.trust.domain || merchant.website || merchant.merchant}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${merchant.trust.domainVerified ? 'bg-primary/15 text-primary' : 'bg-surface-2 text-text-muted'}`}>
                    {merchant.trust.domainVerified ? 'verified' : 'listed'}
                  </span>
                </div>
              </a>
            ))}
          </div>

          {searchLeaderboard.length > 0 && (
            <>
              <PanelTitle icon={Filter} title="Search Merchants" />
              <div className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
                {searchLeaderboard.map((m, index) => (
                  <div key={m.merchant} className="p-4 border-b border-border-default last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-text-muted">#{index + 1}</div>
                        <code className="text-sm text-white truncate block">{short(m.merchant)}</code>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-primary">{m.volume.toFixed(2)}</div>
                        <div className="text-[10px] text-text-muted">{m.count} invoices</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <PanelTitle icon={Activity} title="Live Feed" />
          <div className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
            {activity.length === 0 ? (
              <div className="p-5 text-sm text-text-muted">{activityError || 'No backend events yet.'}</div>
            ) : activity.slice(0, 8).map(item => (
              <LiveActivityRow key={item.id} item={item} onOpen={async () => {
                if (!item.invoiceHash) return;
                const invoice = await getInvoice(item.invoiceHash);
                if (invoice) setSelected(invoice);
              }} />
            ))}
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {selected && (
          <InvoiceModal invoice={selected} onClose={() => setSelected(null)} onCopy={copy} />
        )}
      </AnimatePresence>
    </div>
  );
}

function InvoiceCard({ invoice, onOpen, onCopy }: { invoice: QantaraInvoice; onOpen: () => void; onCopy: (text: string, label: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-1 border border-border-default rounded-2xl p-5 hover:border-primary/30 transition-colors space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="text-left min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <StatusPill invoice={invoice} />
            <span className="text-[10px] uppercase tracking-widest text-text-muted">{typeLabel(invoice.invoiceType)}</span>
          </div>
          <h2 className="text-sm font-bold text-white truncate">{invoice.title || invoice.memo || `Invoice ${short(invoice.hash)}`}</h2>
          <code className="text-xs text-text-muted">{short(invoice.hash)}</code>
        </button>
        <button
          onClick={() => onCopy(`${window.location.origin}/pay/${invoice.hash}`, 'Payment link')}
          className="p-2 rounded-lg bg-surface-2 border border-border-default text-text-muted hover:text-primary hover:border-primary/30"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Mini label="Amount" value={amountOf(invoice)} />
        <Mini label="Merchant" value={short(invoice.merchant)} />
        <Mini label="Created" value={new Date(invoice.createdAt * 1000).toLocaleDateString()} />
      </div>
    </motion.div>
  );
}

function LiveActivityRow({ item, onOpen }: { item: ExplorerActivityRecord; onOpen: () => Promise<void> }) {
  const eventLabel = item.type.replaceAll('.', ' ');
  const amount = item.amount && item.tokenSymbol ? `${item.amount} ${item.tokenSymbol}` : item.amount ?? 'invoice activity';
  return (
    <button
      type="button"
      onClick={() => void onOpen()}
      disabled={!item.invoiceHash}
      className="w-full text-left p-4 border-b border-border-default last:border-b-0 hover:bg-surface-2 transition-colors disabled:cursor-default disabled:hover:bg-transparent"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-white truncate">
            {eventLabel} {amount}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            {timeAgo(item.timestamp)}{item.merchant ? ` · ${short(item.merchant)}` : ''}
          </div>
        </div>
        <span className="text-[10px] uppercase text-text-muted">{item.status ?? 'event'}</span>
      </div>
    </button>
  );
}

function InvoiceModal({ invoice, onClose, onCopy }: { invoice: QantaraInvoice; onClose: () => void; onCopy: (text: string, label: string) => void }) {
  const explorerUrl = qieMainnet.blockExplorers.default.url;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-1 border border-border-default rounded-2xl max-w-2xl w-full max-h-[86vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-surface-1 border-b border-border-default p-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{invoice.title || invoice.memo || 'Invoice detail'}</h2>
            <code className="text-xs text-text-muted">{short(invoice.hash)}</code>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Mini label="Status" value={statusLabel(invoice.status)} />
            <Mini label="Type" value={typeLabel(invoice.invoiceType)} />
            <Mini label="Amount" value={amountOf(invoice)} />
            <Mini label="Payer" value={invoice.payer ? '1' : '0'} />
          </div>

          <Detail label="Invoice hash" value={invoice.hash} />
          <Detail label="Merchant" value={invoice.merchant} />
          <Detail label="Payer" value={invoice.payer ? hashAddress(invoice.payer) : '-'} />
          <Detail label="Created" value={new Date(invoice.createdAt * 1000).toLocaleString()} />
          <Detail label="Expires" value={invoice.expiresAt ? new Date(invoice.expiresAt * 1000).toLocaleString() : 'Never'} />
          <Detail label="Metadata hash" value={invoice.metadataHash} />
          {invoice.paidTxHash && <Detail label="Paid tx" value={invoice.paidTxHash} />}
          {invoice.memo && <Detail label="Memo" value={invoice.memo} />}

          {invoice.invoiceType === InvoiceType.MultiPay && (
            <div className="bg-surface-2 border border-border-default rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-text-muted">Progress</span>
                <span className="text-sm font-bold text-primary">{invoice.amount}</span>
              </div>
              <div className="h-2 bg-surface-1 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: invoice.status === InvoiceStatus.Paid ? '100%' : '0%' }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border-default">
            <Button variant="secondary" size="sm" onClick={() => onCopy(invoice.hash, 'Invoice hash')} className="gap-2">
              <Copy className="w-4 h-4" /> Copy hash
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onCopy(`${window.location.origin}/pay/${invoice.hash}`, 'Payment link')} className="gap-2">
              <Share2 className="w-4 h-4" /> Copy link
            </Button>
            {invoice.paidTxHash && (
              <a href={`${explorerUrl}/tx/${invoice.paidTxHash}`} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm" className="gap-2">
                  <ExternalLink className="w-4 h-4" /> Explorer
                </Button>
              </a>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stat({ icon: Icon, label, value, accent = false }: { icon: typeof Activity; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`bg-surface-1 border rounded-2xl p-4 ${accent ? 'border-primary/30' : 'border-border-default'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${accent ? 'text-primary' : 'text-text-muted'}`} />
        <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${accent ? 'text-primary' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: typeof Activity; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-primary" />
      <h2 className="text-sm font-bold text-white uppercase tracking-widest">{title}</h2>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 border border-border-default rounded-xl p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="text-sm font-bold text-white truncate mt-1">{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs uppercase tracking-widest text-text-muted">{label}</span>
      <code className="text-xs text-white break-all">{value}</code>
    </div>
  );
}

function StatusPill({ invoice }: { invoice: QantaraInvoice }) {
  const status = statusLabel(invoice.status);
  const tone =
    invoice.status === InvoiceStatus.Paid ? 'text-primary bg-primary/10 border-primary/30'
    : invoice.status === InvoiceStatus.Cancelled ? 'text-red-300 bg-red-500/10 border-red-500/30'
    : invoice.status === InvoiceStatus.Paused ? 'text-yellow-300 bg-yellow-500/10 border-yellow-500/30'
    : 'text-secondary bg-secondary/10 border-secondary/30';
  return <span className={`text-[10px] uppercase tracking-widest border px-2 py-0.5 rounded ${tone}`}>{status}</span>;
}

function amountOf(invoice: QantaraInvoice) {
  return `${invoice.amount} ${tokenSymbol(invoice.token)}`;
}

function short(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function hashAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function timeAgo(ts: number) {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
