import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, ExternalLink, Globe, Play, RefreshCw, Route, Settings, Webhook, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { StatusPill, usePaymentRails } from '../../../components/ProductOps';
import { QANTARA_BACKEND_URL } from '../../../lib/dealRoom';
import {
  getDeploymentStatus,
  getPaymentRequirements,
  getPaymentRoutePlan,
  getReconciliationStatus,
  hasMerchantAuth,
  type DeploymentRegistryStatus,
  type PaymentRequirementsResponse,
  type PaymentRoutePlan,
  type ReconciliationStatus,
} from '../../../lib/qantaraApi';

export function BuildSidebarPanels() {
  const [debugHash, setDebugHash] = useState('');

  return (
    <aside className="space-y-4">
      <PaymentRailsPanel />
      <RequirementDebuggerPanel debugHash={debugHash} setDebugHash={setDebugHash} />
      <RoutePlannerPanel debugHash={debugHash} />
      <ContractAddressesPanel />
      <ReconciliationPanel />
      <WebhookEventsPanel />
    </aside>
  );
}

function PaymentRailsPanel() {
  const { catalog: railCatalog, error: railError, isLoading: railsLoading, refresh: refreshRails } = usePaymentRails();

  return (
    <Panel icon={Globe} title="Payment Rails">
      <Info label="Catalog source" value="/v1/rails" />
      <Info label="Backend status" value={railError ?? 'connected'} />
      <Info label="Rails" value={`${railCatalog.rails.length}`} />
      <Info label="Wallets" value={railCatalog.wallets.map((wallet) => wallet.name).join(' / ')} />
      <Info label="Explorer" value={railCatalog.explorer.baseUrl} />
      <div className="space-y-2">
        {railCatalog.rails.map((rail) => (
          <div key={rail.id} className="rounded-xl border border-border-default bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-white">{rail.tokenSymbol}</div>
                <div className="truncate text-xs text-text-muted">{rail.chainName}</div>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${rail.status === 'active' ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'}`}>
                {rail.status}
              </span>
            </div>
            {rail.flows.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {rail.flows.slice(0, 4).map((flow) => (
                  <span key={flow.id} className={`rounded-full px-2 py-1 text-[10px] font-bold ${flow.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-surface-1 text-text-muted'}`}>
                    {flow.label}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest">
              {rail.explorer?.tokenUrl && (
                <a href={rail.explorer.tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-muted hover:text-primary">
                  Token <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {rail.explorer?.settlementContractUrl && (
                <a href={rail.explorer.settlementContractUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-muted hover:text-primary">
                  Contract <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" className="gap-2" loading={railsLoading} onClick={() => void refreshRails()}>
        <RefreshCw className="h-4 w-4" /> Refresh rails
      </Button>
    </Panel>
  );
}

function RequirementDebuggerPanel({ debugHash, setDebugHash }: { debugHash: string; setDebugHash: (value: string) => void }) {
  const [requirements, setRequirements] = useState<PaymentRequirementsResponse | null>(null);
  const [requirementsError, setRequirementsError] = useState<string | null>(null);
  const [requirementsLoading, setRequirementsLoading] = useState(false);

  const loadRequirements = async () => {
    const hash = debugHash.trim();
    if (!hash) {
      setRequirements(null);
      setRequirementsError('Enter an invoice hash to read payment requirements from the backend.');
      return;
    }
    setRequirementsLoading(true);
    setRequirementsError(null);
    try {
      setRequirements(await getPaymentRequirements(hash));
    } catch (err) {
      setRequirements(null);
      setRequirementsError(err instanceof Error ? err.message : 'Payment requirements endpoint unavailable');
    } finally {
      setRequirementsLoading(false);
    }
  };

  return (
    <Panel icon={Wrench} title="Requirement Debugger">
      <Field label="Invoice hash" value={debugHash} onChange={setDebugHash} />
      <Button className="w-full gap-2" loading={requirementsLoading} onClick={() => void loadRequirements()}>
        <Play className="h-4 w-4" /> Fetch from backend
      </Button>
      {requirementsError && (
        <div className="flex gap-2 rounded-xl border border-yellow-400/20 bg-yellow-400/8 p-3 text-xs text-yellow-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
          <span>{requirementsError}</span>
        </div>
      )}
      {requirements && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/8 p-3 text-xs text-primary">
            <CheckCircle className="h-4 w-4" />
            <span>Loaded from /v1/payment-requirements/{requirements.invoiceHash}</span>
          </div>
          <Info label="State" value={requirements.state} />
          <Info label="Verify URL" value={requirements.verifyUrl ?? 'not reported'} />
          {requirements.requirements.length === 0 ? (
            <div className="rounded-xl border border-border-default bg-surface-2 p-3 text-xs text-text-muted">
              Backend returned no payment requirement records for this invoice.
            </div>
          ) : requirements.requirements.map((requirement) => (
            <div key={requirement.id} className="rounded-xl border border-border-default bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-white">{requirement.amount || '-'} {requirement.tokenSymbol}</div>
                  <div className="truncate text-xs text-text-muted">{requirement.scheme} - chain {requirement.chainId}</div>
                </div>
                <StatusPill ok={requirement.state === 'ready'} label={requirement.state} />
              </div>
              <Info label="Merchant" value={requirement.merchant ?? 'not reported'} />
              <Info label="Token" value={requirement.tokenAddress ?? 'native'} />
              <Info label="Verify" value={requirement.verifyUrl ?? requirements.verifyUrl ?? 'not reported'} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function RoutePlannerPanel({ debugHash }: { debugHash: string }) {
  const [routePlan, setRoutePlan] = useState<PaymentRoutePlan | null>(null);
  const [routePlanError, setRoutePlanError] = useState<string | null>(null);
  const [routePlanLoading, setRoutePlanLoading] = useState(false);

  const loadRoutePlan = async () => {
    const hash = debugHash.trim();
    if (!hash) {
      setRoutePlan(null);
      setRoutePlanError('Enter an invoice hash to plan payment routes from the backend.');
      return;
    }
    setRoutePlanLoading(true);
    setRoutePlanError(null);
    try {
      setRoutePlan(await getPaymentRoutePlan(hash));
    } catch (err) {
      setRoutePlan(null);
      setRoutePlanError(err instanceof Error ? err.message : 'Payment route planner endpoint unavailable');
    } finally {
      setRoutePlanLoading(false);
    }
  };

  return (
    <Panel icon={Route} title="Route Planner">
      <div className="rounded-xl border border-border-default bg-surface-2 p-3 text-xs text-text-secondary">
        Routes are computed by the backend from the invoice record, rail catalog, RPC health, and deployment registry.
      </div>
      <Button className="w-full gap-2" loading={routePlanLoading} onClick={() => void loadRoutePlan()}>
        <Route className="h-4 w-4" /> Plan routes
      </Button>
      {routePlanError && (
        <div className="flex gap-2 rounded-xl border border-yellow-400/20 bg-yellow-400/8 p-3 text-xs text-yellow-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
          <span>{routePlanError}</span>
        </div>
      )}
      {routePlan && (
        <div className="space-y-2">
          <div className={`rounded-xl border p-3 text-xs ${routePlan.payable ? 'border-primary/20 bg-primary/8 text-primary' : 'border-yellow-400/20 bg-yellow-400/8 text-yellow-100'}`}>
            <div className="font-bold">{routePlan.payable ? 'Payable' : 'Not payable'} · {routePlan.state}</div>
            <div className="mt-1 text-text-secondary">
              {routePlan.amount} {routePlan.token.symbol} · recommended {routePlan.recommendedRouteId ?? 'none'}
            </div>
          </div>
          <Info label="Sources" value={routePlan.dataSources.join(' / ')} />
          <Info label="Merchant" value={routePlan.merchant} />
          {routePlan.routes.length === 0 ? (
            <div className="rounded-xl border border-border-default bg-surface-2 p-3 text-xs text-text-muted">
              No supported payment route is available for this invoice token.
            </div>
          ) : routePlan.routes.map((route) => (
            <div key={route.id} className="rounded-xl border border-border-default bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-white">{route.label}</div>
                  <div className="truncate text-xs text-text-muted">{route.method} · {route.rail}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${route.state === 'ready' ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'}`}>
                  {route.recommended ? 'recommended' : route.state}
                </span>
              </div>
              <div className="mt-2 text-xs text-text-muted">{route.reason}</div>
              <div className="mt-2 space-y-1">
                {route.actions.map((action) => (
                  <div key={`${route.id}-${action.type}-${action.method ?? action.label}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-[11px]">
                    <span className="text-text-secondary">{action.label}</span>
                    <code className="truncate text-text-muted">{action.method ?? action.type}</code>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ContractAddressesPanel() {
  const merchantAuthReady = hasMerchantAuth();
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentRegistryStatus | null>(null);

  useEffect(() => {
    if (!merchantAuthReady) {
      setDeploymentStatus(null);
      return;
    }
    void getDeploymentStatus().then(setDeploymentStatus).catch(() => setDeploymentStatus(null));
  }, [merchantAuthReady]);

  const contractAddress = (key: string) => (
    !merchantAuthReady
      ? 'wallet sign-in required'
      : deploymentStatus?.contracts.find((contract) => contract.key === key)?.address ?? 'backend unavailable'
  );

  return (
    <Panel icon={Settings} title="Contract Addresses">
      <Info label="QIE Mainnet" value="chain 1990" />
      <Info label="Qantara" value={contractAddress('Qantara')} />
      <Info label="QUSDC" value={contractAddress('QUSDC')} />
      <Info label="Backend" value={`${QANTARA_BACKEND_URL}/v1`} />
    </Panel>
  );
}

function ReconciliationPanel() {
  const [reconciliationStatus, setReconciliationStatus] = useState<ReconciliationStatus | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);

  const loadReconciliationStatus = useCallback(async () => {
    setReconciliationLoading(true);
    setReconciliationError(null);
    try {
      setReconciliationStatus(await getReconciliationStatus());
    } catch (err) {
      setReconciliationStatus(null);
      setReconciliationError(err instanceof Error ? err.message : 'Reconciliation endpoint unavailable');
    } finally {
      setReconciliationLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReconciliationStatus();
  }, [loadReconciliationStatus]);

  return (
    <Panel icon={Settings} title="Reconciliation">
      <div className="rounded-xl border border-border-default bg-surface-2 p-3 text-xs text-text-secondary">
        Backend persisted records only: invoices, receipts, indexed chain events, webhook deliveries, and RPC verification failures.
      </div>
      <Info
        label="Endpoint"
        value={reconciliationLoading ? 'loading /v1/reconciliation/status' : reconciliationError ?? (reconciliationStatus ? 'connected' : 'unavailable')}
      />
      <Info
        label="Invoices"
        value={reconciliationStatus ? `${reconciliationStatus.invoices.total} total / ${reconciliationStatus.invoices.paid} paid` : 'unavailable'}
      />
      <Info
        label="Receipts"
        value={reconciliationStatus ? `${reconciliationStatus.receipts.total} total / ${reconciliationStatus.receipts.missingForPaid} missing` : 'unavailable'}
      />
      <Info
        label="Indexer"
        value={reconciliationStatus ? `${reconciliationStatus.chain.indexer.lagBlocks ?? 'unknown'} lag blocks` : 'unavailable'}
      />
      <Info
        label="Webhook retries"
        value={reconciliationStatus ? `${reconciliationStatus.webhooks.dueRetries} due / ${reconciliationStatus.webhooks.failedDeliveries} failed` : 'unavailable'}
      />
      <Info
        label="RPC verify failures"
        value={reconciliationStatus ? `${reconciliationStatus.rpcVerification.failures24h} in 24h` : 'unavailable'}
      />
      <Button variant="secondary" size="sm" className="w-full gap-2" loading={reconciliationLoading} onClick={() => void loadReconciliationStatus()}>
        <RefreshCw className="h-4 w-4" /> Refresh status
      </Button>
    </Panel>
  );
}

function WebhookEventsPanel() {
  return (
    <Panel icon={Webhook} title="Webhook Events">
      {['invoice.created', 'invoice.paid', 'invoice.expired', 'invoice.cancelled', 'invoice.refunded'].map(event => (
        <div key={event} className="text-xs font-mono text-text-secondary bg-surface-2 border border-border-default rounded-lg px-3 py-2">
          {event}
        </div>
      ))}
    </Panel>
  );
}

export function Panel({ icon: Icon, title, children }: { icon: typeof Settings; title: string; children: ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-surface-1 border border-border-default rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold text-white uppercase tracking-widest">{title}</h2>
      </div>
      {children}
    </motion.section>
  );
}

export function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-muted">{label}</span>
      <code className="text-text-secondary truncate">{value}</code>
    </div>
  );
}

export function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-2 block">
      <span className="text-[10px] uppercase tracking-widest text-text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-11 px-4 rounded-full bg-surface-2 border border-border-default text-sm text-white focus:outline-none focus:border-primary/40"
      />
    </label>
  );
}
