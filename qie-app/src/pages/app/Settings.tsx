import { motion } from 'framer-motion';
import { BadgeCheck, Copy, ExternalLink, Globe, LogOut, Save, ShieldCheck, Wallet, Webhook, MessageCircle, MonitorCog, KeyRound, RefreshCw, AlertTriangle, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useBalance, useDisconnect } from 'wagmi';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { qieMainnet } from '../../config/wagmi';
import { QANTARA_BACKEND_URL } from '../../lib/dealRoom';
import { useBackendHealth, usePaymentRails, WalletHealthCard } from '../../components/ProductOps';
import { useAppPreferencesStore } from '../../store/useInvoiceStore';
import {
  collectOperationalBlockers,
  getMerchantProfile,
  getQieEcosystem,
  getQieLendingStatus,
  getQieNetworkCatalog,
  getReconciliationStatus,
  getSettingsStatus,
  hasMerchantAuth,
  isFailedWebhookDelivery,
  requestDomainChallenge,
  telegramSetupItems,
  updateMerchantProfile,
  verifyDomain,
  type MerchantTrustProfile,
  type QieEcosystem,
  type QieLendingStatus,
  type QieNetworkCatalog,
  type ReconciliationStatus,
  type SettingsStatus,
} from '../../lib/qantaraApi';

export function Settings() {
  const { address, chainId, connector } = useAccount();
  const { data: balanceData } = useBalance({ address });
  const { disconnect } = useDisconnect();
  const { addToast } = useToastStore();
  const { health, error, isLoading, refresh } = useBackendHealth();
  const { catalog: railCatalog, error: railError, isLoading: railsLoading, refresh: refreshRails } = usePaymentRails();
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reconciliationStatus, setReconciliationStatus] = useState<ReconciliationStatus | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [merchantProfile, setMerchantProfile] = useState<MerchantTrustProfile | null>(null);
  const [merchantProfileLoading, setMerchantProfileLoading] = useState(false);
  const [merchantProfileBusy, setMerchantProfileBusy] = useState(false);
  const [merchantProfileError, setMerchantProfileError] = useState<string | null>(null);
  const [merchantDisplayName, setMerchantDisplayName] = useState('');
  const [merchantWebsite, setMerchantWebsite] = useState('');
  const [domainChallengeToken, setDomainChallengeToken] = useState<string | null>(null);
  const [networkCatalog, setNetworkCatalog] = useState<QieNetworkCatalog | null>(null);
  const [networkCatalogLoading, setNetworkCatalogLoading] = useState(false);
  const [networkCatalogError, setNetworkCatalogError] = useState<string | null>(null);
  const [ecosystem, setEcosystem] = useState<QieEcosystem | null>(null);
  const [ecosystemError, setEcosystemError] = useState<string | null>(null);
  const [lendingStatus, setLendingStatus] = useState<QieLendingStatus | null>(null);
  const [lendingLoading, setLendingLoading] = useState(false);
  const [lendingError, setLendingError] = useState<string | null>(null);
  const merchantAuthReady = hasMerchantAuth();
  const {
    compactMode,
    defaultToken,
    setCompactMode,
    setDefaultToken,
  } = useAppPreferencesStore();

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast('success', `${label} copied`);
  };

  const loadSettingsStatus = useCallback(async () => {
    if (!merchantAuthReady) {
      setSettingsStatus(null);
      setSettingsError(null);
      setSettingsLoading(false);
      return;
    }
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      setSettingsStatus(await getSettingsStatus());
    } catch (statusError) {
      setSettingsStatus(null);
      setSettingsError(statusError instanceof Error ? statusError.message : 'Unable to load authenticated settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [merchantAuthReady]);

  useEffect(() => {
    void loadSettingsStatus();
  }, [loadSettingsStatus]);

  const loadReconciliationStatus = useCallback(async () => {
    setReconciliationLoading(true);
    setReconciliationError(null);
    try {
      setReconciliationStatus(await getReconciliationStatus());
    } catch (statusError) {
      setReconciliationStatus(null);
      setReconciliationError(statusError instanceof Error ? statusError.message : 'Reconciliation endpoint unavailable');
    } finally {
      setReconciliationLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReconciliationStatus();
  }, [loadReconciliationStatus]);

  const loadMerchantProfile = useCallback(async () => {
    if (!merchantAuthReady) {
      setMerchantProfile(null);
      setMerchantProfileError(null);
      setMerchantDisplayName('');
      setMerchantWebsite('');
      setDomainChallengeToken(null);
      return;
    }
    setMerchantProfileLoading(true);
    setMerchantProfileError(null);
    try {
      const profile = await getMerchantProfile();
      setMerchantProfile(profile);
      setMerchantDisplayName(profile.displayName ?? '');
      setMerchantWebsite(profile.website ?? profile.trust.domain ?? '');
    } catch (profileError) {
      setMerchantProfile(null);
      setMerchantProfileError(profileError instanceof Error ? profileError.message : 'Unable to load merchant profile');
    } finally {
      setMerchantProfileLoading(false);
    }
  }, [merchantAuthReady]);

  useEffect(() => {
    void loadMerchantProfile();
  }, [loadMerchantProfile]);

  const loadQieEcosystemStatus = useCallback(async () => {
    setNetworkCatalogLoading(true);
    setNetworkCatalogError(null);
    setEcosystemError(null);
    try {
      const [catalog, links] = await Promise.all([
        getQieNetworkCatalog(),
        getQieEcosystem(),
      ]);
      setNetworkCatalog(catalog);
      setEcosystem(links);
    } catch (statusError) {
      setNetworkCatalog(null);
      setEcosystem(null);
      const message = statusError instanceof Error ? statusError.message : 'QIE ecosystem status unavailable';
      setNetworkCatalogError(message);
      setEcosystemError(message);
    } finally {
      setNetworkCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQieEcosystemStatus();
  }, [loadQieEcosystemStatus]);

  const loadLendingStatus = useCallback(async () => {
    setLendingLoading(true);
    setLendingError(null);
    try {
      setLendingStatus(await getQieLendingStatus(address));
    } catch (statusError) {
      setLendingStatus(null);
      setLendingError(statusError instanceof Error ? statusError.message : 'QIE lending status unavailable');
    } finally {
      setLendingLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void loadLendingStatus();
  }, [loadLendingStatus]);

  const saveMerchantProfile = async () => {
    setMerchantProfileBusy(true);
    setMerchantProfileError(null);
    try {
      const profile = await updateMerchantProfile({
        display_name: merchantDisplayName.trim(),
        website: merchantWebsite.trim(),
        public_listed: merchantProfile?.listed ?? false,
      });
      setMerchantProfile(profile);
      setMerchantDisplayName(profile.displayName ?? '');
      setMerchantWebsite(profile.website ?? profile.trust.domain ?? '');
      addToast('success', 'Merchant profile saved');
    } catch (profileError) {
      setMerchantProfileError(profileError instanceof Error ? profileError.message : 'Merchant profile update failed');
      addToast('error', profileError instanceof Error ? profileError.message : 'Merchant profile update failed');
    } finally {
      setMerchantProfileBusy(false);
    }
  };

  const toggleMerchantListing = async (listed: boolean) => {
    setMerchantProfileBusy(true);
    setMerchantProfileError(null);
    try {
      const profile = await updateMerchantProfile({
        display_name: merchantDisplayName.trim(),
        website: merchantWebsite.trim(),
        public_listed: listed,
      });
      setMerchantProfile(profile);
      addToast('success', listed ? 'Merchant listing enabled' : 'Merchant listing disabled');
    } catch (profileError) {
      setMerchantProfileError(profileError instanceof Error ? profileError.message : 'Merchant listing update failed');
      addToast('error', profileError instanceof Error ? profileError.message : 'Merchant listing update failed');
    } finally {
      setMerchantProfileBusy(false);
    }
  };

  const startDomainChallenge = async () => {
    const domain = merchantWebsite.trim();
    if (!domain) {
      addToast('warning', 'Enter a website origin before requesting a domain challenge');
      return;
    }
    setMerchantProfileBusy(true);
    setMerchantProfileError(null);
    try {
      const challenge = await requestDomainChallenge(domain);
      setDomainChallengeToken(challenge.token);
      await navigator.clipboard.writeText(challenge.token);
      addToast('success', 'Domain challenge token copied');
    } catch (profileError) {
      setMerchantProfileError(profileError instanceof Error ? profileError.message : 'Domain challenge failed');
      addToast('error', profileError instanceof Error ? profileError.message : 'Domain challenge failed');
    } finally {
      setMerchantProfileBusy(false);
    }
  };

  const runDomainVerify = async () => {
    setMerchantProfileBusy(true);
    setMerchantProfileError(null);
    try {
      const profile = await verifyDomain();
      setMerchantProfile(profile);
      setMerchantDisplayName(profile.displayName ?? '');
      setMerchantWebsite(profile.website ?? profile.trust.domain ?? '');
      setDomainChallengeToken(null);
      addToast('success', 'Merchant domain verified');
    } catch (profileError) {
      setMerchantProfileError(profileError instanceof Error ? profileError.message : 'Domain verification failed');
      addToast('error', profileError instanceof Error ? profileError.message : 'Domain verification failed');
    } finally {
      setMerchantProfileBusy(false);
    }
  };

  const operational = settingsStatus?.operational ?? health?.operational;
  const deploymentRegistry = settingsStatus?.contracts.registry;
  const authStatusLabel = !merchantAuthReady
    ? 'merchant sign-in required'
    : settingsLoading
      ? 'loading authenticated status'
      : settingsError
        ? 'authenticated request failed'
        : settingsStatus?.ok
          ? 'authenticated'
          : 'waiting for backend';
  const authStatusTone = merchantAuthReady && settingsStatus?.ok && !settingsError ? 'good' : 'warn';
  const operationalBlockers = collectOperationalBlockers({
    walletConnected: Boolean(address),
    currentChainId: chainId,
    expectedChainId: qieMainnet.id,
    hasMerchantAuth: merchantAuthReady,
    backendHealth: health,
    backendError: error,
    settingsStatus,
    settingsError,
  });
  const telegramReadiness = telegramSetupItems(settingsStatus, merchantAuthReady);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-text-secondary">Runtime configuration and wallet state from the connected backend and QIE RPC. Operational settings use merchant wallet sign-in in the browser.</p>
      </div>

      {!merchantAuthReady && (
        <section className="rounded-2xl border border-yellow-400/20 bg-yellow-400/8 p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-300">
                <KeyRound className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">Merchant authentication is required</h2>
                <p className="max-w-2xl text-sm text-text-secondary">
                  Operational settings, webhook delivery logs, alert state, and notification read state are authenticated backend resources. Sign in with the merchant wallet to enable browser operations.
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy(`${QANTARA_BACKEND_URL}/v1/auth/nonce`, 'SIWE nonce URL')}>
              <Copy className="h-4 w-4" /> Copy auth URL
            </Button>
          </div>
        </section>
      )}

      {merchantAuthReady && (
        <section className={`rounded-2xl border p-5 ${settingsError ? 'border-red-500/20 bg-red-500/8' : 'border-border-default bg-surface-1'}`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-3">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${settingsError ? 'bg-red-500/10 text-red-300' : 'bg-primary/10 text-primary'}`}>
                {settingsError ? <AlertTriangle className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-white">Authenticated operations</h2>
                <p className="max-w-2xl text-sm text-text-secondary">
                  {settingsError
                    ? `Merchant authentication is configured, but the backend rejected or failed the status request: ${settingsError}`
                    : 'Settings below are loaded from authenticated backend status and persisted operational records.'}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="gap-2" loading={settingsLoading} onClick={() => void loadSettingsStatus()}>
              <RefreshCw className="h-4 w-4" /> Refresh operations
            </Button>
          </div>
        </section>
      )}

      <section className={`rounded-2xl border p-5 ${operationalBlockers.length > 0 ? 'border-yellow-400/20 bg-yellow-400/8' : 'border-primary/20 bg-primary/8'}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {operationalBlockers.length > 0 ? <AlertTriangle className="h-5 w-5 text-yellow-300" /> : <ShieldCheck className="h-5 w-5 text-primary" />}
              <h2 className="text-lg font-bold text-white">{operationalBlockers.length > 0 ? 'Operational blockers' : 'Operational readiness'}</h2>
            </div>
            {operationalBlockers.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {operationalBlockers.slice(0, 8).map((blocker) => (
                  <div key={blocker} className="rounded-xl border border-yellow-400/15 bg-surface-1 px-3 py-2 text-sm text-yellow-100">
                    {blocker}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">Wallet, backend, RPC, contract registry, and authenticated merchant operations are reporting ready state.</p>
            )}
          </div>
          <Button variant="secondary" size="sm" className="gap-2" loading={isLoading || settingsLoading || railsLoading || reconciliationLoading || merchantProfileLoading || networkCatalogLoading || lendingLoading} onClick={() => { void refresh(); void loadSettingsStatus(); void refreshRails(); void loadReconciliationStatus(); void loadMerchantProfile(); void loadQieEcosystemStatus(); void loadLendingStatus(); }}>
            <RefreshCw className="h-4 w-4" /> Refresh all
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <WalletHealthCard />

        <Panel icon={ShieldCheck} title="Backend health">
          <InfoTile label="REST base" value={QANTARA_BACKEND_URL} />
          <InfoTile label="Authenticated status" value={authStatusLabel} tone={authStatusTone} />
          <InfoTile
            label="Merchant scope"
            value={!merchantAuthReady ? 'auth required' : settingsLoading ? 'loading authenticated status' : `${settingsStatus?.backend.invoices ?? 0} invoices visible`}
            tone={settingsStatus?.ok ? 'good' : 'warn'}
          />
          <InfoTile label="Health" value={health?.ok ? 'online' : error || 'unavailable'} tone={health?.ok ? 'good' : 'warn'} />
          <InfoTile
            label="Rail catalog"
            value={railError ? `backend unavailable - ${railError}` : `${railCatalog.rails.length} backend rails`}
            tone={railCatalog.rails.some((rail) => rail.status === 'active') ? 'good' : 'warn'}
          />
          <InfoTile label="Database" value={health?.db || 'unknown'} tone={health?.db === 'ok' ? 'good' : 'warn'} />
          <InfoTile
            label="Schema"
            value={!merchantAuthReady ? 'auth required' : settingsLoading ? 'loading authenticated status' : health?.migrations?.current || settingsStatus?.backend.migrations?.current || 'not reported'}
            tone={(health?.migrations?.current || settingsStatus?.backend.migrations?.current) ? 'good' : 'warn'}
          />
          <InfoTile label="RPC" value={health?.rpc?.ok ? `chain ${health.rpc.chainId} - block ${health.rpc.blockNumber}` : health?.rpc?.error || 'unknown'} tone={health?.rpc?.ok ? 'good' : 'warn'} />
          <InfoTile label="Indexer" value={health?.indexer?.configured ? `${health.indexer.cursors[0]?.lastBlock || 0}` : 'contract not configured'} tone={health?.indexer?.configured ? 'good' : 'warn'} />
          <InfoTile label="Operational" value={operational?.ok ? 'healthy' : 'needs attention'} tone={operational?.ok ? 'good' : 'warn'} />
          <Button variant="secondary" size="sm" className="gap-2" loading={isLoading} onClick={() => void refresh()}>
            <ShieldCheck className="h-4 w-4" /> Refresh health
          </Button>
        </Panel>

        <Panel icon={Globe} title="QIE network catalog">
          <InfoTile
            label="Catalog"
            value={networkCatalogLoading ? 'loading backend catalog' : networkCatalogError ? `unavailable - ${networkCatalogError}` : networkCatalog?.source ?? 'waiting for backend'}
            tone={networkCatalog?.ok ? 'good' : 'warn'}
          />
          <InfoTile
            label="Active network"
            value={networkCatalog?.activeNetwork ?? 'qie-mainnet'}
            tone={networkCatalog?.ok ? 'good' : 'warn'}
          />
          <div className="space-y-2">
            {(networkCatalog?.networks ?? []).map((network) => (
              <div key={network.key} className="rounded-2xl border border-border-default bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white">{network.name}</div>
                    <div className="truncate text-xs text-text-muted">chain {network.chainId} - {network.explorer.baseUrl}</div>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase text-primary">
                    {network.rpcUrls.length} RPCs
                  </span>
                </div>
                <div className="mt-2 grid gap-1.5">
                  {network.rpcUrls.slice(0, 3).map((rpc) => (
                    <div key={`${network.key}-${rpc.url}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-[11px]">
                      <span className="min-w-0 truncate text-text-secondary">{rpc.url}</span>
                      <span className="shrink-0 text-text-muted">{rpc.preferred ? 'preferred' : rpc.source}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={network.explorer.baseUrl} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm" className="gap-2"><ExternalLink className="h-4 w-4" /> Explorer</Button>
                  </a>
                  {network.faucetUrl && (
                    <a href={network.faucetUrl} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm" className="gap-2"><ExternalLink className="h-4 w-4" /> Faucet</Button>
                    </a>
                  )}
                  <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy(JSON.stringify(network.walletAddNetwork, null, 2), `${network.name} wallet payload`)}>
                    <Copy className="h-4 w-4" /> Wallet payload
                  </Button>
                </div>
              </div>
            ))}
            {!networkCatalog?.networks?.length && (
              <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-4 text-sm text-text-muted">
                QIE network catalog is loaded from the backend. No fallback network status is fabricated in the browser.
              </div>
            )}
          </div>
          <Button variant="secondary" size="sm" className="gap-2" loading={networkCatalogLoading} onClick={() => void loadQieEcosystemStatus()}>
            <RefreshCw className="h-4 w-4" /> Refresh catalog
          </Button>
        </Panel>

        <Panel icon={Globe} title="QIE ecosystem links">
          <InfoTile
            label="Registry"
            value={ecosystemError ? `unavailable - ${ecosystemError}` : ecosystem?.source ?? 'waiting for backend'}
            tone={ecosystem?.ok ? 'good' : 'warn'}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {(ecosystem?.links ?? []).map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-border-default bg-surface-2 p-3 transition hover:border-primary/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">{link.name}</div>
                    <div className="truncate text-xs text-text-muted">{link.category} - {link.reason}</div>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0 text-text-muted" />
                </div>
              </a>
            ))}
          </div>
        </Panel>

        <Panel icon={Wallet} title="Wallet details">
          <div className="flex items-center gap-4 rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 font-bold text-primary">
              {address ? address.slice(2, 4).toUpperCase() : '--'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <code className="truncate text-sm text-white">{address || 'Wallet not connected'}</code>
                {address && (
                  <button onClick={() => copy(address, 'Address')} className="text-text-muted hover:text-primary">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {connector?.name || 'No connector'} - {balanceData ? `${Number(balanceData.formatted).toFixed(4)} ${balanceData.symbol}` : 'balance unavailable'}
              </div>
            </div>
            {address && (
              <a href={`${qieMainnet.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer" className="text-text-muted hover:text-primary">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoTile label="Network" value="QIE Mainnet" />
            <InfoTile label="Chain" value={String(chainId || qieMainnet.id)} />
          </div>

          <Button variant="danger" className="w-full gap-2" onClick={() => disconnect()}>
            <LogOut className="h-4 w-4" /> Disconnect
          </Button>
        </Panel>

        <Panel icon={Users} title="Team accounts">
          <InfoTile
            label="Account mode"
            value={!merchantAuthReady ? 'auth required' : settingsStatus?.team?.mode.replaceAll('_', ' ') ?? 'single merchant wallet'}
            tone={settingsStatus?.team ? 'good' : 'warn'}
          />
          <InfoTile
            label="Members"
            value={!merchantAuthReady ? 'auth required' : `${settingsStatus?.team?.members.length ?? 0} active owner wallet`}
            tone={(settingsStatus?.team?.members.length ?? 0) > 0 ? 'good' : 'warn'}
          />
          <InfoTile
            label="Payout wallet"
            value={!merchantAuthReady ? 'auth required' : settingsStatus?.team?.payoutWallet ?? 'not configured'}
            tone={settingsStatus?.team?.payoutWallet ? 'good' : 'warn'}
          />
          <InfoTile
            label="Merchant wallets"
            value={!merchantAuthReady ? 'auth required' : `${settingsStatus?.team?.merchantWallets.length ?? 0} wallet boundary`}
            tone={(settingsStatus?.team?.merchantWallets.length ?? 0) > 0 ? 'good' : 'warn'}
          />
          <div className="space-y-2">
            {(settingsStatus?.team?.members ?? []).map((member) => (
              <div key={member.address} className="rounded-2xl border border-border-default bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-bold text-white">{member.address}</div>
                    <div className="text-xs text-text-muted">{member.source}</div>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                    {member.role}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-text-muted">Roles ready for expansion</div>
            <div className="flex flex-wrap gap-1.5">
              {(settingsStatus?.team?.roles ?? ['owner', 'developer', 'support', 'finance', 'viewer']).map((role) => (
                <span key={role} className="rounded-md bg-surface-1 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                  {role}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-text-muted">Notification routing</div>
            <div className="space-y-2 text-xs text-text-secondary">
              <div>Webhook: {settingsStatus?.team?.notificationRouting.webhook ?? 'auth required'}</div>
              <div>Telegram: {settingsStatus?.team?.notificationRouting.telegram ?? 'auth required'}</div>
              <div>Alerts: {settingsStatus?.team?.notificationRouting.alerts ?? 'auth required'}</div>
            </div>
          </div>
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-text-muted">Recent audit log</div>
            {(settingsStatus?.team?.auditLog ?? []).length === 0 ? (
              <div className="text-sm text-text-muted">No authenticated merchant audit events reported yet.</div>
            ) : (
              <div className="space-y-2">
                {settingsStatus!.team!.auditLog.slice(0, 5).map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-xs">
                    <span className="truncate text-text-secondary">{event.type}</span>
                    <span className="shrink-0 text-text-muted">{new Date(event.createdAt * 1000).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel icon={BadgeCheck} title="Merchant trust profile">
          <div className="flex flex-wrap gap-2">
            <TrustBadge ok={!!merchantProfile?.trust.walletVerified} label="Wallet verified" />
            <TrustBadge ok={!!merchantProfile?.trust.telegramVerified} label="Telegram linked" />
            <TrustBadge ok={!!merchantProfile?.trust.domainVerified} label={merchantProfile?.trust.domain ? `Domain: ${merchantProfile.trust.domain}` : 'Domain verified'} />
            <TrustBadge ok={!!merchantProfile?.trust.pass?.verified} label={merchantProfile?.trust.pass?.configured ? `QIE Pass: ${merchantProfile.trust.pass.status}` : 'QIE Pass not configured'} />
            <TrustBadge ok={!!merchantProfile?.listed} label="Public directory" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoTile label="Recent paid invoices" value={`${merchantProfile?.recentPaidCount ?? merchantProfile?.recentPaid ?? 0}`} tone={(merchantProfile?.recentPaidCount ?? merchantProfile?.recentPaid ?? 0) > 0 ? 'good' : 'warn'} />
            <InfoTile label="Explorer profile" value={merchantProfile?.explorerUrl ?? 'waiting for profile'} tone={merchantProfile?.explorerUrl ? 'good' : 'warn'} />
          </div>

          {merchantProfileError && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-300">
              {merchantProfileError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Display name"
              value={merchantDisplayName}
              onChange={setMerchantDisplayName}
              placeholder="Qantara merchant"
              disabled={!merchantAuthReady || merchantProfileBusy}
            />
            <TextField
              label="Website origin"
              value={merchantWebsite}
              onChange={setMerchantWebsite}
              placeholder="https://"
              disabled={!merchantAuthReady || merchantProfileBusy}
            />
          </div>

          <label className="flex items-center justify-between rounded-2xl border border-border-default bg-surface-2 p-4">
            <div>
              <div className="text-sm font-bold text-white">Public merchant directory</div>
              <div className="mt-1 text-xs text-text-muted">Opt in only after the profile and trust signals are ready.</div>
            </div>
            <button
              type="button"
              disabled={!merchantAuthReady || merchantProfileBusy}
              onClick={() => void toggleMerchantListing(!merchantProfile?.listed)}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${merchantProfile?.listed ? 'bg-primary' : 'bg-surface-3'}`}
              aria-label="Toggle public merchant directory listing"
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${merchantProfile?.listed ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </label>

          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Globe className="h-4 w-4 text-primary" /> Domain verification
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Serve the token at <code className="text-primary">/.well-known/qantara.txt</code> on the website origin, then verify.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" className="gap-2" loading={merchantProfileBusy} disabled={!merchantAuthReady} onClick={() => void startDomainChallenge()}>
                  <Copy className="h-4 w-4" /> Get token
                </Button>
                <Button size="sm" className="gap-2" loading={merchantProfileBusy} disabled={!merchantAuthReady} onClick={() => void runDomainVerify()}>
                  <BadgeCheck className="h-4 w-4" /> Verify
                </Button>
              </div>
            </div>
            {domainChallengeToken && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2">
                <code className="min-w-0 truncate text-xs text-primary">{domainChallengeToken}</code>
                <button type="button" className="shrink-0 text-text-muted hover:text-primary" onClick={() => copy(domainChallengeToken, 'Domain token')}>
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-2" loading={merchantProfileBusy} disabled={!merchantAuthReady} onClick={() => void saveMerchantProfile()}>
              <Save className="h-4 w-4" /> Save profile
            </Button>
            {merchantProfile?.merchant && (
              <a href={`/profile/${merchantProfile.merchant}`} className="inline-flex">
                <Button variant="secondary" size="sm" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Public profile
                </Button>
              </a>
            )}
          </div>
        </Panel>

        <Panel icon={ShieldCheck} title="Contract registry">
          <InfoTile
            label="Network"
            value={!merchantAuthReady ? 'auth required' : deploymentRegistry ? `${deploymentRegistry.network} - chain ${deploymentRegistry.chainId}` : 'waiting for backend'}
            tone={deploymentRegistry?.requiredConfigured ? 'good' : 'warn'}
          />
          <InfoTile
            label="Release"
            value={!merchantAuthReady ? 'auth required' : deploymentRegistry?.release ?? 'unknown'}
            tone={deploymentRegistry?.ok ? 'good' : 'warn'}
          />
          <InfoTile
            label="Required contracts"
            value={!merchantAuthReady ? 'auth required' : deploymentRegistry?.requiredConfigured ? 'configured' : 'QANTARA_ADDRESS missing or mismatched'}
            tone={deploymentRegistry?.requiredConfigured ? 'good' : 'warn'}
          />
          <div className="space-y-2">
            {(deploymentRegistry?.contracts ?? []).slice(0, 6).map((contract) => (
              <div key={contract.key} className="rounded-2xl border border-border-default bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">{contract.label}</div>
                    <div className="truncate text-xs text-text-muted">{contract.address}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${contract.status === 'configured' ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'}`}>
                    {contract.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy(`${QANTARA_BACKEND_URL}/v1/deployments/status`, 'Deployment status URL')}>
            <Copy className="h-4 w-4" /> Copy registry URL
          </Button>
        </Panel>

        <Panel icon={ShieldCheck} title="Payment rails">
          <InfoTile
            label="Catalog source"
            value="backend /v1/rails"
            tone={railError ? 'warn' : 'good'}
          />
          <InfoTile
            label="Active rails"
            value={`${railCatalog.rails.filter((rail) => rail.status === 'active').length} of ${railCatalog.rails.length}`}
            tone={railCatalog.rails.some((rail) => rail.status === 'active') ? 'good' : 'warn'}
          />
          <div className="space-y-2">
            {railCatalog.rails.map((rail) => (
              <div key={rail.id} className="rounded-2xl border border-border-default bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">{rail.tokenSymbol} on {rail.chainName}</div>
                    <div className="truncate text-xs text-text-muted">{rail.contractAddress ?? rail.tokenAddress ?? 'Not configured'}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${rail.status === 'active' ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'}`}>
                    {rail.status}
                  </span>
                </div>
                {rail.flows.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rail.flows.map((flow) => (
                      <span key={flow.id} className={`rounded-full px-2 py-1 text-[10px] font-bold ${flow.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-surface-1 text-text-muted'}`}>
                        {flow.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="gap-2" loading={railsLoading} onClick={() => void refreshRails()}>
            <RefreshCw className="h-4 w-4" /> Refresh rails
          </Button>
        </Panel>

        <Panel icon={MonitorCog} title="QIE lending awareness">
          <InfoTile
            label="Endpoint"
            value={lendingLoading ? 'reading QIE lending contracts' : lendingError ? `unavailable - ${lendingError}` : lendingStatus?.source ?? 'waiting for backend'}
            tone={lendingStatus?.ok ? 'good' : 'warn'}
          />
          <InfoTile
            label="Comptroller"
            value={lendingStatus?.comptroller ?? 'not loaded'}
            tone={lendingStatus?.ok ? 'good' : 'warn'}
          />
          <InfoTile
            label="Portfolio"
            value={address ? lendingStatus?.address ? 'connected wallet scoped' : 'waiting for RPC reads' : 'connect wallet for portfolio'}
            tone={address && lendingStatus?.address ? 'good' : 'warn'}
          />
          <div className="space-y-2">
            {(lendingStatus?.markets ?? []).map((market) => (
              <div key={market.symbol} className="rounded-2xl border border-border-default bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white">{market.symbol}</div>
                    <div className="truncate text-xs text-text-muted">cToken {market.cToken}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${market.status === 'available' ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'}`}>
                    {market.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <InfoMini label="Total supply" value={formatTokenUnits(market.totals.supply, market.decimals)} />
                  <InfoMini label="Total borrow" value={formatTokenUnits(market.totals.borrow, market.decimals)} />
                  <InfoMini label="Wallet supplied" value={formatTokenUnits(market.portfolio?.supplied ?? null, market.decimals)} />
                  <InfoMini label="Wallet borrowed" value={formatTokenUnits(market.portfolio?.borrowed ?? null, market.decimals)} />
                </div>
                {market.error && <div className="mt-2 text-xs text-yellow-200">{market.error}</div>}
              </div>
            ))}
            {!lendingStatus?.markets?.length && (
              <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-4 text-sm text-text-muted">
                Lending markets are read from QIE RPC through the backend. No market totals are synthesized locally.
              </div>
            )}
          </div>
          <Button variant="secondary" size="sm" className="gap-2" loading={lendingLoading} onClick={() => void loadLendingStatus()}>
            <RefreshCw className="h-4 w-4" /> Refresh lending
          </Button>
        </Panel>

        <Panel icon={Webhook} title="Webhooks">
          <InfoTile label="Signing" value={!merchantAuthReady ? 'auth required' : settingsStatus?.webhooks.signingConfigured ? 'HMAC configured' : 'WEBHOOK_SECRET missing'} tone={settingsStatus?.webhooks.signingConfigured ? 'good' : 'warn'} />
          <InfoTile label="Delivery status" value={!merchantAuthReady ? 'auth required' : `${settingsStatus?.webhooks.recentDeliveries.length ?? 0} recent deliveries`} />
          <InfoTile label="Delivery scope" value={!merchantAuthReady ? 'auth required' : `${settingsStatus?.webhooks.stats?.totalDeliveries ?? 0} merchant deliveries`} />
          <InfoTile label="Retry queue" value={!merchantAuthReady ? 'auth required' : `${operational?.webhooks.dueRetries ?? settingsStatus?.webhooks.dueRetries ?? 0} due`} tone={(operational?.webhooks.dueRetries ?? settingsStatus?.webhooks.dueRetries ?? 0) > 0 ? 'warn' : 'good'} />
          <InfoTile label="Failed deliveries" value={!merchantAuthReady ? 'auth required' : `${operational?.webhooks.failedDeliveries ?? settingsStatus?.webhooks.stats?.failedDeliveries ?? 0}`} tone={(operational?.webhooks.failedDeliveries ?? settingsStatus?.webhooks.stats?.failedDeliveries ?? 0) > 0 ? 'warn' : 'good'} />
          <InfoTile label="Events" value="invoice.created, message.created, invoice.paid, receipt.created" />
          {merchantAuthReady && !settingsLoading && !settingsError && (
            <div className="space-y-2">
              {(settingsStatus?.webhooks.recentDeliveries ?? []).length > 0 ? (
                settingsStatus!.webhooks.recentDeliveries.slice(0, 4).map((delivery) => (
                  <div key={delivery.id} className="rounded-2xl border border-border-default bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white">{delivery.eventType}</div>
                        <div className="truncate text-xs text-text-muted">{delivery.invoiceHash}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${isFailedWebhookDelivery(delivery) ? 'bg-red-500/10 text-red-300' : 'bg-primary/15 text-primary'}`}>
                        {delivery.status || 'network'}
                      </span>
                    </div>
                    {delivery.lastError && <div className="mt-2 truncate text-xs text-yellow-200">{delivery.lastError}</div>}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-4 text-sm text-text-muted">
                  No persisted webhook deliveries reported for this merchant scope.
                </div>
              )}
            </div>
          )}
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy(`${QANTARA_BACKEND_URL}/v1`, 'API base')}>
            <Copy className="h-4 w-4" /> Copy API base
          </Button>
        </Panel>

        <Panel icon={MonitorCog} title="Reconciliation">
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4 text-sm text-text-secondary">
            Data source: backend persisted invoices, receipts, chain events, webhook deliveries, and RPC verification records from <code className="text-white">/v1/reconciliation/status</code>.
          </div>
          <InfoTile
            label="Endpoint"
            value={reconciliationLoading ? 'loading persisted records' : reconciliationError ? `unavailable - ${reconciliationError}` : reconciliationStatus ? 'backend persisted records' : 'waiting for backend'}
            tone={reconciliationStatus?.ok ? 'good' : 'warn'}
          />
          <InfoTile
            label="Invoices"
            value={!reconciliationStatus ? 'unavailable' : `${reconciliationStatus.invoices.total} total / ${reconciliationStatus.invoices.open} open / ${reconciliationStatus.invoices.paid} paid`}
            tone={reconciliationStatus ? 'good' : 'warn'}
          />
          <InfoTile
            label="Closed states"
            value={!reconciliationStatus ? 'unavailable' : `${reconciliationStatus.invoices.cancelled} cancelled / ${reconciliationStatus.invoices.refunded} refunded / ${reconciliationStatus.invoices.paused} paused`}
          />
          <InfoTile
            label="Receipts"
            value={!reconciliationStatus ? 'unavailable' : `${reconciliationStatus.receipts.total} total / ${reconciliationStatus.receipts.missingForPaid} paid missing receipt`}
            tone={(reconciliationStatus?.receipts.missingForPaid ?? 0) > 0 ? 'warn' : reconciliationStatus ? 'good' : 'warn'}
          />
          <InfoTile
            label="Chain indexer"
            value={!reconciliationStatus ? 'unavailable' : reconciliationStatus.chain.indexer.lagBlocks !== undefined ? `${reconciliationStatus.chain.indexer.lagBlocks} lag blocks` : reconciliationStatus.chain.indexer.lastError ?? 'waiting for cursor'}
            tone={reconciliationStatus?.chain.indexer.healthy ? 'good' : 'warn'}
          />
          <InfoTile
            label="Chain events"
            value={!reconciliationStatus ? 'unavailable' : `${reconciliationStatus.chain.events.total} total / ${reconciliationStatus.chain.events.recent} recent`}
          />
          <InfoTile
            label="Webhook failures"
            value={!reconciliationStatus ? 'unavailable' : `${reconciliationStatus.webhooks.failedDeliveries} failed / ${reconciliationStatus.webhooks.dueRetries} due retry`}
            tone={(reconciliationStatus?.webhooks.failedDeliveries ?? 0) > 0 || (reconciliationStatus?.webhooks.dueRetries ?? 0) > 0 ? 'warn' : reconciliationStatus ? 'good' : 'warn'}
          />
          <InfoTile
            label="RPC verify failures"
            value={!reconciliationStatus ? 'unavailable' : `${reconciliationStatus.rpcVerification.failures24h} in 24h`}
            tone={(reconciliationStatus?.rpcVerification.failures24h ?? 0) > 0 ? 'warn' : reconciliationStatus ? 'good' : 'warn'}
          />
          <Button variant="secondary" size="sm" className="gap-2" loading={reconciliationLoading} onClick={() => void loadReconciliationStatus()}>
            <RefreshCw className="h-4 w-4" /> Refresh reconciliation
          </Button>
        </Panel>

        <Panel icon={MonitorCog} title="Operations">
          <InfoTile
            label="Indexer lag"
            value={!merchantAuthReady ? 'auth required' : operational?.indexer.lagBlocks !== undefined ? `${operational.indexer.lagBlocks} blocks` : 'waiting for cursor'}
            tone={operational?.indexer.healthy ? 'good' : 'warn'}
          />
          <InfoTile
            label="Cursor age"
            value={!merchantAuthReady ? 'auth required' : operational?.indexer.cursorStaleSeconds !== undefined ? `${operational.indexer.cursorStaleSeconds}s` : 'unknown'}
            tone={operational?.indexer.healthy ? 'good' : 'warn'}
          />
          <InfoTile
            label="RPC verify failures"
            value={!merchantAuthReady ? 'auth required' : `${operational?.rpcVerification.failures24h ?? 0} in 24h`}
            tone={(operational?.rpcVerification.failures24h ?? 0) > 0 ? 'warn' : 'good'}
          />
          <InfoTile
            label="Webhook max attempts"
            value={!merchantAuthReady ? 'auth required' : `${operational?.webhooks.maxAttempts ?? 0}`}
            tone={(operational?.webhooks.maxAttempts ?? 0) > 3 ? 'warn' : 'good'}
          />
          <InfoTile
            label="Alerts"
            value={!merchantAuthReady ? 'auth required' : `${operational?.alerts.length ?? 0} active`}
            tone={(operational?.alerts.length ?? 0) > 0 ? 'warn' : 'good'}
          />
          <InfoTile
            label="Alert webhook"
            value={!merchantAuthReady ? 'auth required' : settingsStatus?.alerts?.webhookConfigured ? `${settingsStatus.alerts.minSeverity}` : 'not configured'}
            tone={settingsStatus?.alerts?.webhookConfigured ? 'good' : 'warn'}
          />
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy(`${QANTARA_BACKEND_URL}/v1/metrics`, 'Metrics URL')}>
            <Copy className="h-4 w-4" /> Copy metrics URL
          </Button>
        </Panel>

        <Panel icon={MessageCircle} title="Telegram">
          {telegramReadiness.map((item) => (
            <InfoTile key={item.label} label={item.label} value={item.value} tone={item.ok ? 'good' : 'warn'} />
          ))}
          <InfoTile label="Command scope" value="linked invoice chats only" tone={settingsStatus?.telegram.botTokenConfigured ? 'good' : 'warn'} />
          <InfoTile label="Reply scope" value="writes persisted deal-room messages" tone={settingsStatus?.telegram.botTokenConfigured && settingsStatus?.webhooks.signingConfigured ? 'good' : 'warn'} />
          <InfoTile label="Event scope" value="payment, receipt, and message notifications" tone={settingsStatus?.webhooks.signingConfigured ? 'good' : 'warn'} />
          <InfoTile label="Commands" value="/link, /status, /chat, /reply, /list, /help" />
          <a href="/app/telegram-bot"><Button variant="secondary" size="sm">Open bot setup</Button></a>
        </Panel>

        <Panel icon={MonitorCog} title="Display">
          <ToggleRow label="Compact dashboard tables" checked={compactMode} onChange={setCompactMode} />
          <div className="rounded-2xl border border-border-default bg-surface-2 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-text-muted">Default token</div>
            <div className="flex gap-2">
              {(['QIE', 'QUSDC'] as const).map((token) => (
                <button
                  key={token}
                  onClick={() => setDefaultToken(token)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${defaultToken === token ? 'bg-primary text-black' : 'bg-surface-1 text-text-secondary'}`}
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="space-y-5 rounded-2xl border border-border-default bg-surface-1 p-6">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      {children}
    </motion.section>
  );
}

function InfoTile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-default bg-surface-2 p-4">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-bold ${tone === 'good' ? 'text-primary' : tone === 'warn' ? 'text-yellow-300' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function InfoMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-1 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-xs font-bold text-white">{value}</div>
    </div>
  );
}

function formatTokenUnits(value: string | null | undefined, decimals: number): string {
  if (!value) return 'unavailable';
  try {
    const raw = BigInt(value);
    const scale = 10n ** BigInt(decimals);
    const whole = raw / scale;
    const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction.slice(0, 6)}` : whole.toString();
  } catch {
    return 'unavailable';
  }
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <label className="block rounded-2xl border border-border-default bg-surface-2 p-4">
      <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-2 h-10 w-full rounded-xl border border-border-default bg-surface-1 px-3 text-sm text-white outline-none placeholder:text-text-dim focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function TrustBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
      ok ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text-dim'
    }`}>
      <ShieldCheck className="h-3 w-3" /> {label}
    </span>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-2xl border border-border-default bg-surface-2 p-4">
      <span className="text-sm font-bold text-white">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-surface-3'}`}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
      </button>
    </label>
  );
}
