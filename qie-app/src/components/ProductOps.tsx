import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle,
  Copy,
  ExternalLink,
  MessageCircle,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useBalance, useSwitchChain } from 'wagmi';
import { Button } from './Button';
import { qieMainnet } from '../config/wagmi';
import {
  emptyPaymentRailCatalog,
  getBackendHealth,
  getPaymentRailCatalog,
  hasMerchantAuth,
  railForToken,
  tokenSymbol,
  toPayUrl,
  type BackendHealth,
  type PaymentRailCatalog,
  type QantaraInvoice,
} from '../lib/qantaraApi';
import { QANTARA_BACKEND_URL } from '../lib/dealRoom';
import { useToastStore } from './ToastContainer';

export function useBackendHealth() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setHealth(await getBackendHealth());
    } catch (err: any) {
      setHealth(null);
      setError(err?.message ?? 'Backend unavailable');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { health, error, isLoading, refresh };
}

export function usePaymentRails() {
  const [catalog, setCatalog] = useState<PaymentRailCatalog>(() => emptyPaymentRailCatalog());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setCatalog(await getPaymentRailCatalog());
    } catch (err: any) {
      setCatalog(emptyPaymentRailCatalog());
      setError(err?.message ?? 'Rail catalog unavailable');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { catalog, error, isLoading, refresh };
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
      ok ? 'border-primary/30 bg-primary/10 text-primary' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-primary' : 'bg-yellow-300'}`} />
      {label}
    </span>
  );
}

export function WalletHealthCard({ compact = false }: { compact?: boolean }) {
  const { address, chainId, connector, isConnected } = useAccount();
  const { data: balanceData, error: balanceError, isLoading: balanceLoading, refetch: refetchBalance } = useBalance({ address });
  const { switchChainAsync, isPending } = useSwitchChain();
  const { health, error, isLoading, refresh } = useBackendHealth();
  const { addToast } = useToastStore();

  const onQie = chainId === qieMainnet.id;
  const hasKnownGas = Boolean(balanceData);
  const hasGas = balanceData ? balanceData.value > 0n : false;
  const balanceValue = !isConnected
    ? 'Connect wallet'
    : balanceLoading
      ? 'Checking balance'
      : balanceError
        ? 'Balance unavailable — retry'
        : balanceData
          ? `${Number(balanceData.formatted).toFixed(4)} ${balanceData.symbol}`
          : 'Balance unavailable';

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    addToast('success', 'Address copied');
  };

  const switchNetwork = async () => {
    try {
      await switchChainAsync({ chainId: qieMainnet.id });
    } catch (err: any) {
      addToast('error', err?.shortMessage || err?.message || 'Could not switch network');
    }
  };

  if (compact) {
    return (
      <div className="rounded-xl border border-border-default bg-surface-1 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill ok={isConnected} label={isConnected ? 'Wallet' : 'No wallet'} />
          <StatusPill ok={onQie} label={onQie ? 'QIE chain' : 'Wrong chain'} />
          <StatusPill ok={!!health?.ok && !error} label={health?.ok ? 'Backend' : 'Backend'} />
          {isConnected && hasKnownGas && !hasGas && <StatusPill ok={false} label="Need gas" />}
        </div>
      </div>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="space-y-5 rounded-2xl border border-border-default bg-surface-1 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wallet className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-bold text-white">Wallet and network health</h2>
            <p className="text-xs text-text-muted">Preflight checks before creating or paying invoices.</p>
          </div>
        </div>
        <button onClick={() => void refresh()} className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-primary">
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <HealthRow ok={isConnected} label="Wallet" value={connector?.name || 'Not connected'} />
        <HealthRow ok={onQie} label="Network" value={onQie ? 'QIE Mainnet' : `Chain ${chainId || '-'}`} />
        <HealthRow ok={!!health?.ok && !error} label="Backend API" value={health?.ok ? `${QANTARA_BACKEND_URL}` : error || 'Unavailable'} />
        <HealthRow ok={hasGas} label="Gas balance" value={balanceValue} />
      </div>

      <div className="flex flex-wrap gap-2">
        {address && (
          <>
            <Button variant="secondary" size="sm" onClick={copyAddress}><Copy className="h-4 w-4" /> Copy address</Button>
            <a href={`${qieMainnet.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm"><ExternalLink className="h-4 w-4" /> Explorer</Button>
            </a>
          </>
        )}
        {isConnected && !onQie && (
          <Button size="sm" loading={isPending} onClick={switchNetwork}>Switch to QIE Mainnet</Button>
        )}
        {isConnected && balanceError && (
          <Button variant="secondary" size="sm" onClick={() => void refetchBalance()}><RefreshCw className="h-4 w-4" /> Retry balance</Button>
        )}
      </div>
    </motion.section>
  );
}

function HealthRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-2 p-4">
      <div className="mb-1 flex items-center gap-2">
        {ok ? <CheckCircle className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-yellow-300" />}
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</span>
      </div>
      <div className="truncate text-sm font-bold text-white">{value}</div>
    </div>
  );
}

export function SetupChecklist({
  hasInvoices,
  hasUnread,
  health,
  healthError,
  healthLoading,
  railCatalog,
  railError,
}: {
  hasInvoices: boolean;
  hasUnread: boolean;
  health?: BackendHealth | null;
  healthError?: string | null;
  healthLoading?: boolean;
  railCatalog?: PaymentRailCatalog | null;
  railError?: string | null;
}) {
  const { isConnected, chainId } = useAccount();
  const merchantAuthConfigured = hasMerchantAuth();
  const rpcValue = healthLoading
    ? 'Checking RPC'
    : health?.rpc?.ok
      ? `Chain ${health.rpc.chainId}, block ${health.rpc.blockNumber}`
      : health?.rpc?.error || 'RPC not verified';
  const items = [
    { label: 'Wallet connected', value: isConnected ? 'Ready for signing' : 'Connect merchant wallet', ok: isConnected },
    { label: 'QIE Mainnet selected', value: chainId === qieMainnet.id ? 'Chain 1990' : `Current chain ${chainId || '-'}`, ok: chainId === qieMainnet.id },
    { label: 'Backend API reachable', value: healthLoading ? 'Checking backend' : health?.ok ? health.db : healthError || 'Unavailable', ok: !!health?.ok && !healthError },
    { label: 'QIE RPC verified', value: rpcValue, ok: !!health?.rpc?.ok },
    {
      label: 'Payment rails',
      value: railError ? `Backend unavailable: ${railError}` : `${railCatalog?.rails.length ?? 0} backend rails`,
      ok: (railCatalog?.rails.some((rail) => rail.status === 'active') ?? false),
    },
    { label: 'Merchant sign-in', value: merchantAuthConfigured ? 'Merchant operations enabled' : 'Sign in with wallet', ok: merchantAuthConfigured },
    { label: 'Payment activity', value: hasInvoices ? 'Invoices loaded from backend' : 'No invoices for this wallet', ok: hasInvoices },
    { label: 'Action queue', value: hasUnread ? 'Unread events need review' : 'No unread events', ok: !hasUnread },
  ];
  return (
    <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
      <div className="mb-4 flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h2 className="font-bold text-white">Setup checklist</h2>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-bold text-text-secondary">{item.label}</div>
              <div className="truncate text-xs text-text-muted">{item.value}</div>
            </div>
            {item.ok ? <CheckCircle className="h-4 w-4 shrink-0 text-primary" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-300" />}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProductionSetupPanel() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-surface-1 to-surface-1 p-6">
      <div className="qie-mesh-bg pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative space-y-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div>
            <h2 className="font-bold text-white">Production setup path</h2>
            <p className="text-xs text-text-muted">Create invoices through the wallet flow, then use backend status and QIE RPC to confirm settlement.</p>
          </div>
        </div>
        <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-3">
          <div className="rounded-xl bg-surface-2 p-3">1. Sign and create invoice</div>
          <div className="rounded-xl bg-surface-2 p-3">2. Bind operations channels</div>
          <div className="rounded-xl bg-surface-2 p-3">3. Verify settlement on QIE RPC</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/new-cipher"><Button className="gap-2">Create invoice</Button></Link>
          <Link to="/app/settings"><Button variant="secondary" className="gap-2"><Settings className="h-4 w-4" /> Check operations</Button></Link>
          <Link to="/app/telegram-bot"><Button variant="ghost" className="gap-2"><MessageCircle className="h-4 w-4" /> Telegram setup</Button></Link>
        </div>
      </div>
    </section>
  );
}

export function InvoiceActionMenu({ invoice, onReply }: { invoice: QantaraInvoice; onReply?: () => void }) {
  const { addToast } = useToastStore();
  const payUrl = toPayUrl(invoice.hash);
  const copy = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    addToast('success', `${label} copied`);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => copy(payUrl, 'Pay link')}><Copy className="h-4 w-4" /> Copy pay link</Button>
      <a href={`/pay/${invoice.hash}`} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink className="h-4 w-4" /> Open</Button></a>
      {onReply && <Button variant="ghost" size="sm" onClick={onReply}><MessageCircle className="h-4 w-4" /> Reply</Button>}
    </div>
  );
}

export function PayTrustRail({ invoice }: { invoice: QantaraInvoice }) {
  const symbol = tokenSymbol(invoice.token);
  const { catalog } = usePaymentRails();
  const rail = railForToken(catalog, invoice.token);
  const activeFlows = rail?.flows.filter((flow) => flow.status === 'active') ?? [];
  const steps = useMemo(() => [
    'Review invoice',
    'Confirm in wallet',
    'Verify on QIE RPC',
    'Receive receipt',
  ], []);
  return (
    <section className="space-y-3 rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill ok label="Backend verified invoice" />
        <StatusPill ok label={`${invoice.amount} ${symbol}`} />
        <StatusPill ok={rail?.status === 'active'} label={rail ? `${rail.chainName} rail` : 'Rail unavailable'} />
        {activeFlows.slice(0, 2).map((flow) => <StatusPill key={flow.id} ok label={flow.label} />)}
        {invoice.expiresAt > 0 && <StatusPill ok={Math.floor(Date.now() / 1000) < invoice.expiresAt} label="Expiry checked" />}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step} className="rounded-xl bg-surface-2 p-3 text-xs">
            <div className="mb-1 flex items-center gap-2 text-text-muted"><Radio className="h-3.5 w-3.5 text-primary" /> Step {index + 1}</div>
            <div className="font-bold text-white">{step}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
