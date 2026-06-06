import { Copy, ExternalLink, RefreshCw, Search, ShieldCheck, Users, WalletCards } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { qieMainnet } from '../../config/wagmi';
import { useSiweAuth } from '../../lib/auth';
import {
  getMerchantCustomers,
  tokenSymbol,
  MerchantAuthMissingError,
  type MerchantCustomer,
} from '../../lib/qantaraApi';

type SortKey = 'recent' | 'volume' | 'paid' | 'invoices';

export function Customers() {
  const { address, isAuthenticated, status, login } = useSiweAuth();
  const { addToast } = useToastStore();
  const [customers, setCustomers] = useState<MerchantCustomer[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setCustomers([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setCustomers(await getMerchantCustomers());
    } catch (err) {
      setCustomers([]);
      setError(err instanceof MerchantAuthMissingError ? 'Sign in with the merchant wallet' : err instanceof Error ? err.message : 'Customers unavailable');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = customers.filter((customer) => !q || customer.payer.toLowerCase().includes(q));
    const volumeOf = (customer: MerchantCustomer) => customer.volume.reduce((sum, item) => sum + Number(item.paidVolume || 0), 0);
    return rows.sort((a, b) => {
      if (sort === 'volume') return volumeOf(b) - volumeOf(a);
      if (sort === 'paid') return b.paid - a.paid;
      if (sort === 'invoices') return b.invoices - a.invoices;
      return b.lastActivityAt - a.lastActivityAt;
    });
  }, [customers, search, sort]);

  const summary = useMemo(() => {
    const totalInvoices = customers.reduce((sum, customer) => sum + customer.invoices, 0);
    const paid = customers.reduce((sum, customer) => sum + customer.paid, 0);
    const repeat = customers.filter((customer) => customer.invoices > 1).length;
    const volume = new Map<string, number>();
    for (const customer of customers) {
      for (const item of customer.volume) {
        const symbol = tokenSymbol(item.token);
        volume.set(symbol, (volume.get(symbol) ?? 0) + Number(item.paidVolume || 0));
      }
    }
    return {
      total: customers.length,
      repeat,
      conversion: totalInvoices > 0 ? Math.round((paid / totalInvoices) * 100) : 0,
      volume: Array.from(volume.entries()).map(([symbol, value]) => `${value.toFixed(2)} ${symbol}`).join(' / ') || '0',
    };
  }, [customers]);

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    addToast('success', `${label} copied`);
  };

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <Header />
        <section className="rounded-2xl border border-yellow-400/20 bg-yellow-400/8 p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-yellow-300" />
              <div>
                <h2 className="font-bold text-white">Merchant sign-in required</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Customer records are scoped to {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'the connected merchant wallet'}.
                </p>
              </div>
            </div>
            <Button loading={status === 'signing' || status === 'verifying'} onClick={() => void login()}>
              Sign in with wallet
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <Header />
        <Button variant="secondary" className="gap-2" loading={isLoading} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-300">{error}</div>}

      <section className="grid gap-4 md:grid-cols-4">
        <Stat icon={Users} label="Customers" value={String(summary.total)} />
        <Stat icon={Users} label="Repeat payers" value={String(summary.repeat)} />
        <Stat icon={ShieldCheck} label="Paid ratio" value={`${summary.conversion}%`} accent />
        <Stat icon={WalletCards} label="Volume" value={summary.volume} />
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search payer address"
              className="h-11 w-full rounded-xl border border-border-default bg-surface-2 pl-10 pr-3 font-mono text-sm text-white outline-none placeholder:text-text-dim focus:border-primary"
            />
          </div>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-11 rounded-xl border border-border-default bg-surface-2 px-3 text-sm text-white outline-none focus:border-primary"
          >
            <option value="recent">Recent activity</option>
            <option value="volume">Paid volume</option>
            <option value="paid">Paid invoices</option>
            <option value="invoices">Total invoices</option>
          </select>
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-2xl border border-border-default bg-surface-1 p-12 text-center text-sm text-text-muted">Loading customers...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-surface-1 p-12 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-text-muted" />
          <h2 className="font-bold text-white">No customers in this view</h2>
          <p className="mt-1 text-sm text-text-secondary">Payers appear after backend-confirmed invoice activity.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((customer) => (
            <CustomerCard key={customer.payer} customer={customer} onCopy={copy} />
          ))}
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-4xl font-bold tracking-tight text-white">Customers</h1>
      <p className="mt-1 max-w-3xl text-text-secondary">Merchant payer records from backend invoices: repeat payers, paid count, volume, and last activity.</p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent = false }: { icon: typeof Users; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-surface-1 p-4 ${accent ? 'border-primary/30' : 'border-border-default'}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent ? 'text-primary' : 'text-text-muted'}`} />
        <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      </div>
      <div className={`truncate text-2xl font-bold ${accent ? 'text-primary' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function CustomerCard({ customer, onCopy }: { customer: MerchantCustomer; onCopy: (value: string, label: string) => void }) {
  const paidRatio = customer.invoices > 0 ? Math.round((customer.paid / customer.invoices) * 100) : 0;
  return (
    <article className="space-y-4 rounded-2xl border border-border-default bg-surface-1 p-5 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <code className="block truncate text-sm font-bold text-white">{customer.payer}</code>
          <p className="mt-1 text-xs text-text-muted">Last activity {new Date(customer.lastActivityAt * 1000).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted hover:text-primary" onClick={() => void onCopy(customer.payer, 'Payer address')} title="Copy payer">
            <Copy className="h-4 w-4" />
          </button>
          <a className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted hover:text-primary" href={`${qieMainnet.blockExplorers.default.url}/address/${customer.payer}`} target="_blank" rel="noreferrer" title="Open explorer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Mini label="Invoices" value={String(customer.invoices)} />
        <Mini label="Paid" value={String(customer.paid)} />
        <Mini label="Paid ratio" value={`${paidRatio}%`} />
      </div>

      <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-text-muted">Paid volume</div>
        {customer.volume.length === 0 ? (
          <div className="text-sm text-text-muted">No settled volume yet</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {customer.volume.map((row) => (
              <span key={row.token} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                {row.paidVolume} {tokenSymbol(row.token)}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-2 p-3">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-white">{value}</div>
    </div>
  );
}
