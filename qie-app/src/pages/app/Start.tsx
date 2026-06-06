import { motion } from 'framer-motion';
import { ArrowRight, Bell, CheckCircle, KeyRound, MessageCircle, Plus, ReceiptText, RefreshCw, Settings, Sparkles, AlertTriangle, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { Button } from '../../components/Button';
import { ProductionSetupPanel, SetupChecklist, WalletHealthCard, InvoiceActionMenu, useBackendHealth, usePaymentRails } from '../../components/ProductOps';
import { useInvoices } from '../../hooks/useInvoices';
import { useNotifications } from '../../hooks/useNotifications';
import { collectOperationalBlockers, hasMerchantAuth, InvoiceStatus } from '../../lib/qantaraApi';
import { qieMainnet } from '../../config/wagmi';
import { getQieNetworkCatalog, type QieNetworkCatalog } from '../../lib/api/qieApi';
import { useEffect, useState } from 'react';

export function Start() {
  const { chainId, isConnected } = useAccount();
  const { rawInvoices, isLoading } = useInvoices();
  const { unreadCount, setupRequired, walletRequired, canUseNotifications, errorMessage } = useNotifications();
  const { health, error: healthError, isLoading: healthLoading, refresh: refreshHealth } = useBackendHealth();
  const { catalog: railCatalog, error: railError, isLoading: railsLoading, refresh: refreshRails } = usePaymentRails();
  const [networkCatalog, setNetworkCatalog] = useState<QieNetworkCatalog | null>(null);
  const [networkCatalogError, setNetworkCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getQieNetworkCatalog()
      .then((catalog) => {
        if (!active) return;
        setNetworkCatalog(catalog);
        setNetworkCatalogError(null);
      })
      .catch((err) => {
        if (!active) return;
        setNetworkCatalog(null);
        setNetworkCatalogError(err instanceof Error ? err.message : 'QIE network catalog unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  const openInvoices = rawInvoices.filter((invoice) => invoice.status === InvoiceStatus.Created);
  const paidInvoices = rawInvoices.filter((invoice) => invoice.status === InvoiceStatus.Paid);
  const latestInvoice = rawInvoices[0];
  const attention = [
    ...openInvoices.slice(0, 2).map((invoice) => ({ invoice, label: 'Awaiting payment' })),
    ...paidInvoices.slice(0, 1).map((invoice) => ({ invoice, label: 'Receipt ready' })),
  ];
  const notificationState = setupRequired
    ? 'Merchant sign-in required'
    : walletRequired
      ? 'Connect wallet'
      : errorMessage
        ? 'Backend event error'
        : canUseNotifications
          ? `${unreadCount} unread`
          : 'Waiting for events';
  const operationalBlockers = collectOperationalBlockers({
    walletConnected: isConnected,
    currentChainId: chainId,
    expectedChainId: qieMainnet.id,
    hasMerchantAuth: hasMerchantAuth(),
    backendHealth: health,
    backendError: healthError,
  });
  const activeNetwork = networkCatalog?.networks.find((network) => network.key === networkCatalog.activeNetwork) ?? networkCatalog?.networks[0] ?? null;
  const testnetNetwork = networkCatalog?.networks.find((network) => network.key === 'qie-testnet') ?? null;

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-secondary/10 via-surface-1 to-surface-1 p-6 md:p-8">
        <div className="qie-mesh-bg pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_360px] lg:items-center">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Payment workspace
            </span>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-5xl">
                Start accepting QIE payments with a guided flow.
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-text-secondary md:text-base">
                Create an invoice, share the pay link, answer payer questions in the deal room,
                and let the backend verify settlement through QIE RPC before a receipt is issued.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/app/new-cipher"><Button><Plus className="h-4 w-4" /> Create invoice</Button></Link>
              <Link to="/app/telegram-bot"><Button variant="secondary"><MessageCircle className="h-4 w-4" /> Connect Telegram</Button></Link>
              <Link to="/app/api-keys"><Button variant="secondary"><KeyRound className="h-4 w-4" /> Create API key</Button></Link>
              <Link to="/app/build"><Button variant="ghost"><Webhook className="h-4 w-4" /> Setup webhook</Button></Link>
              <Link to="/app/settings"><Button variant="ghost"><Settings className="h-4 w-4" /> Check setup</Button></Link>
            </div>
          </div>
          <SetupChecklist
            hasInvoices={rawInvoices.length > 0}
            hasUnread={unreadCount > 0}
            health={health}
            healthError={healthError}
            healthLoading={healthLoading}
            railCatalog={railCatalog}
            railError={railError}
          />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <ReadinessTile
          label="Backend API"
          value={healthLoading ? 'Checking backend' : health?.ok ? `online - ${health.db}` : healthError || 'unavailable'}
          ok={!!health?.ok && !healthError}
        />
        <ReadinessTile
          label="QIE RPC"
          value={health?.rpc?.ok ? `block ${health.rpc.blockNumber} via ${health.rpc.url || 'backend RPC'}` : health?.rpc?.error || 'not verified yet'}
          ok={!!health?.rpc?.ok}
        />
        <ReadinessTile
          label="QIE catalog"
          value={networkCatalogError ? 'catalog unavailable' : activeNetwork ? `${activeNetwork.rpcUrls.length} RPCs / ${testnetNetwork?.faucetUrl ? 'faucet ready' : 'no faucet'}` : 'loading network catalog'}
          ok={!!networkCatalog?.ok && !networkCatalogError}
        />
        <ReadinessTile
          label="Payment rails"
          value={railsLoading ? 'Loading rails' : railError ? 'Backend rails unavailable' : `${railCatalog.rails.length} backend rails`}
          ok={railCatalog.rails.some((rail) => rail.status === 'active')}
        />
        <div className="rounded-2xl border border-border-default bg-surface-1 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Merchant events</div>
              <div className={`mt-1 truncate text-sm font-bold ${canUseNotifications && !errorMessage ? 'text-primary' : 'text-yellow-300'}`}>
                {notificationState}
              </div>
            </div>
            {canUseNotifications && !errorMessage ? <CheckCircle className="h-5 w-5 shrink-0 text-primary" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-300" />}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" className="gap-2" loading={healthLoading || railsLoading} onClick={() => { void refreshHealth(); void refreshRails(); }}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            {(setupRequired || walletRequired || errorMessage) && (
              <Link to="/app/settings">
                <Button variant="ghost" size="sm">Fix setup</Button>
              </Link>
            )}
          </div>
        </div>
      </section>

      {operationalBlockers.length > 0 && (
        <section className="rounded-2xl border border-yellow-400/20 bg-yellow-400/8 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-300" />
                <h2 className="font-bold text-white">Operational blockers</h2>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {operationalBlockers.slice(0, 6).map((blocker) => (
                  <div key={blocker} className="rounded-xl border border-yellow-400/15 bg-surface-1 px-3 py-2 text-sm text-yellow-100">
                    {blocker}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="gap-2" loading={healthLoading} onClick={() => void refreshHealth()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              <Link to="/app/settings"><Button size="sm">Open settings</Button></Link>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <div className="space-y-6">
          <ProductionSetupPanel />

          <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-white">Continue where you left off</h2>
                <p className="text-xs text-text-muted">Recent invoices and actions that keep the payment flow moving.</p>
              </div>
              <Link to="/app/dashboard" className="text-xs font-bold uppercase tracking-widest text-primary hover:underline">
                Dashboard <ArrowRight className="inline h-3 w-3" />
              </Link>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-surface-2" />)}
              </div>
            ) : attention.length > 0 ? (
              <div className="space-y-3">
                {attention.map(({ invoice, label }) => (
                  <motion.div key={invoice.hash} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-border-default bg-surface-2 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-text-muted">{invoice.hash.slice(0, 12)}...</span>
                        </div>
                        <div className="mt-1 text-sm font-bold text-white">{invoice.title || invoice.memo || label}</div>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">{label}</span>
                    </div>
                    <InvoiceActionMenu invoice={invoice} />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border-default bg-surface-2 p-8 text-center">
                <ReceiptText className="mx-auto mb-3 h-8 w-8 text-text-muted" />
                <div className="font-bold text-white">No payment activity yet</div>
                <p className="mt-1 text-sm text-text-muted">
                  {latestInvoice
                    ? 'Change filters in the dashboard to review recent backend invoices.'
                    : 'Create an invoice from the wallet-backed flow to start receiving payment activity.'}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <WalletHealthCard />
          <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
            <div className="mb-4 flex items-center gap-3">
              <Bell className="h-5 w-5 text-primary" />
              <div>
                <h2 className="font-bold text-white">Notifications</h2>
                <p className="text-xs text-text-muted">Messages, payments, and receipt events appear in one place.</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-surface-2 p-4">
              <span className="text-sm text-text-secondary">{canUseNotifications ? 'Unread events' : 'Event access'}</span>
              <span className={`text-right text-lg font-bold ${canUseNotifications ? 'text-white' : 'text-yellow-300'}`}>
                {canUseNotifications ? unreadCount : notificationState}
              </span>
            </div>
            <Link to="/app/notifications" className="mt-3 block">
              <Button variant="secondary" className="w-full">Open notification center</Button>
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function ReadinessTile({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</div>
          <div className={`mt-1 truncate text-sm font-bold ${ok ? 'text-primary' : 'text-yellow-300'}`}>{value}</div>
        </div>
        {ok ? <CheckCircle className="h-5 w-5 shrink-0 text-primary" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-300" />}
      </div>
    </div>
  );
}
