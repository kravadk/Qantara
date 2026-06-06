import { motion } from 'framer-motion';
import { BarChart3, BadgeCheck, Download, Gauge, Globe, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { useSiweAuth } from '../../lib/auth';
import {
  getBillingSummary,
  getMerchantAnalytics,
  getMerchantCustomers,
  getMerchantProfile,
  receiptsCsvUrl,
  requestDomainChallenge,
  tokenSymbol,
  updateMerchantProfile,
  verifyDomain,
  MerchantAuthMissingError,
  type BillingSummary,
  type MerchantAnalytics,
  type MerchantCustomer,
  type MerchantTrustProfile,
} from '../../lib/qantaraApi';

function Panel({ icon: Icon, title, tone, children }: { icon: typeof BarChart3; title: string; tone?: 'default' | 'warn'; children: React.ReactNode }) {
  const border = tone === 'warn' ? 'border-yellow-400/20 bg-yellow-400/8' : 'border-border-default bg-surface-1';
  const iconTone = tone === 'warn' ? 'bg-yellow-400/10 text-yellow-300' : 'bg-primary/10 text-primary';
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`space-y-5 rounded-2xl border p-6 ${border}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      {children}
    </motion.section>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? 'text-primary' : 'text-white'} tabular-nums`}>{value}</div>
    </div>
  );
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function Billing() {
  const { address, isAuthenticated, status, login } = useSiweAuth();
  const { addToast } = useToastStore();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [analytics, setAnalytics] = useState<MerchantAnalytics | null>(null);
  const [customers, setCustomers] = useState<MerchantCustomer[]>([]);
  const [profile, setProfile] = useState<MerchantTrustProfile | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setSummary(null);
      setAnalytics(null);
      setProfile(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [s, a, c, p] = await Promise.all([
        getBillingSummary(),
        getMerchantAnalytics().catch(() => null),
        getMerchantCustomers().catch(() => []),
        getMerchantProfile().catch(() => null),
      ]);
      setSummary(s);
      setAnalytics(a);
      setCustomers(c);
      setProfile(p);
      if (p?.website) setDomainInput(p.website);
    } catch (err) {
      setSummary(null);
      setError(err instanceof MerchantAuthMissingError ? 'Sign in to view billing' : err instanceof Error ? err.message : 'Failed to load billing');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const saveProfile = async (patch: { display_name?: string; website?: string; public_listed?: boolean }) => {
    setBusy(true);
    try {
      setProfile(await updateMerchantProfile(patch));
      addToast('success', 'Profile updated');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setBusy(false);
    }
  };

  const startDomain = async () => {
    setBusy(true);
    try {
      const { token } = await requestDomainChallenge(domainInput.trim());
      addToast('info', 'Serve the token at /.well-known/qantara.txt, then verify');
      navigator.clipboard.writeText(token);
      addToast('success', 'Challenge token copied');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to start domain check');
    } finally {
      setBusy(false);
    }
  };

  const runVerifyDomain = async () => {
    setBusy(true);
    try {
      setProfile(await verifyDomain());
      addToast('success', 'Domain verified');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Domain verification failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <div className="space-y-2">
      <h1 className="text-4xl font-bold tracking-tight text-white">Billing</h1>
      <p className="text-text-secondary">
        Your settlement overview — invoice counts by status and paid volume per token. Funds settle directly to your
        wallet on-chain; this dashboard reflects what the indexer has confirmed.
      </p>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        {header}
        <Panel icon={Wallet} title="Sign in to view billing" tone="warn">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <p className="max-w-2xl text-sm text-text-secondary">
              Billing is scoped to {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'your connected wallet'}.
              Sign in to load your volume and invoice stats.
            </p>
            <Button variant="primary" size="md" className="gap-2" loading={status === 'signing' || status === 'verifying'} onClick={() => void login()}>
              <ShieldCheck className="h-4 w-4" /> Sign in with wallet
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {header}

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-300">{error}</div>
      )}

      <Panel icon={BarChart3} title="Invoices">
        {isLoading ? (
          <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">Loading…</div>
        ) : summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Total" value={summary.total} />
            <StatTile label="Paid" value={summary.byStatus.paid} accent />
            <StatTile label="Created" value={summary.byStatus.created} />
            <StatTile label="Cancelled" value={summary.byStatus.cancelled} />
            <StatTile label="Refunded" value={summary.byStatus.refunded} />
            <StatTile label="Paused" value={summary.byStatus.paused} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">No data yet.</div>
        )}
      </Panel>

      <Panel icon={Wallet} title="Paid volume by token">
        {summary && summary.tokens.length > 0 ? (
          <div className="space-y-3">
            {summary.tokens.map((row) => (
              <div key={row.token} className="flex items-center justify-between rounded-2xl border border-border-default bg-surface-2 p-4">
                <div>
                  <div className="text-sm font-bold text-white">{tokenSymbol(row.token)}</div>
                  <div className="text-xs text-text-muted">{row.paidCount} paid invoice{row.paidCount === 1 ? '' : 's'}</div>
                </div>
                <div className="text-xl font-bold text-primary tabular-nums">{row.paidVolume}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">
            No settled payments yet. Volume appears here once invoices are paid and confirmed on-chain.
          </div>
        )}
      </Panel>

      <Panel icon={Gauge} title="Performance">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Conversion" value={analytics ? `${Math.round(analytics.conversionRate * 100)}%` : '—'} accent />
            <StatTile label="Avg time to pay" value={analytics ? fmtDuration(analytics.avgTimeToPaySeconds) : '—'} />
            <StatTile label="Webhook fails" value={analytics ? `${Math.round(analytics.webhook.failureRate * 100)}%` : '—'} />
            <StatTile label="Webhooks sent" value={analytics ? analytics.webhook.total : '—'} />
          </div>
          <a
            href={receiptsCsvUrl()}
            className="inline-flex items-center gap-2 rounded-xl border border-border-default bg-surface-2 px-4 py-2 text-sm font-bold text-white transition hover:border-primary/40"
          >
            <Download className="h-4 w-4" /> Export receipts (CSV)
          </a>
          <p className="text-xs text-text-muted">Tax-ready settlement ledger. CSV download is authenticated in your browser session.</p>
        </div>
      </Panel>

      <Panel icon={Users} title="Customers">
        {customers.length > 0 ? (
          <div className="space-y-2">
            {customers.slice(0, 25).map((c) => (
              <div key={c.payer} className="flex items-center justify-between gap-3 rounded-2xl border border-border-default bg-surface-2 p-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm text-white">{c.payer.slice(0, 8)}…{c.payer.slice(-6)}</div>
                  <div className="text-xs text-text-muted">{c.paid}/{c.invoices} paid · last {new Date(c.lastActivityAt * 1000).toLocaleDateString()}</div>
                </div>
                <div className="text-right text-xs text-text-secondary">
                  {c.volume.length === 0 ? '—' : c.volume.map((v) => `${v.paidVolume} ${tokenSymbol(v.token)}`).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">
            No customers yet. Payers appear here once they settle an invoice.
          </div>
        )}
      </Panel>

      <Panel icon={BadgeCheck} title="Merchant verification & trust">
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <TrustBadge ok={!!profile?.trust.walletVerified} label="Wallet verified" />
            <TrustBadge ok={!!profile?.trust.telegramVerified} label="Telegram linked" />
            <TrustBadge ok={!!profile?.trust.domainVerified} label={profile?.trust.domain ? `Domain: ${profile.trust.domain}` : 'Domain verified'} />
            <TrustBadge ok={!!profile?.listed} label="Public listing" />
          </div>

          <label className="flex items-center gap-3 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={!!profile?.listed}
              disabled={busy}
              onChange={(e) => void saveProfile({ public_listed: e.target.checked })}
            />
            List my merchant in the public explorer directory
          </label>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-text-muted">Domain verification</p>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-border-default bg-surface-2 px-3 py-2">
                <Globe className="h-4 w-4 text-text-muted" />
                <input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="https://"
                  className="bg-transparent text-sm text-white outline-none placeholder:text-text-dim"
                />
              </div>
              <Button variant="secondary" size="sm" loading={busy} onClick={() => void startDomain()}>Get token</Button>
              <Button variant="primary" size="sm" loading={busy} onClick={() => void runVerifyDomain()}>Verify domain</Button>
            </div>
            <p className="text-xs text-text-muted">
              Put the copied token at <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-primary">{'<domain>/.well-known/qantara.txt'}</code>, then click Verify.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function TrustBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
        ok ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text-dim'
      }`}
    >
      <ShieldCheck className="h-3 w-3" /> {label}
    </span>
  );
}
