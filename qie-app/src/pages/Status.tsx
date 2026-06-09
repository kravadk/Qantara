import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, Clock, Database, RefreshCw, Server, Wifi } from 'lucide-react';
import { Button } from '../components/Button';
import { QANTARA_BACKEND_URL } from '../lib/dealRoom';
import { getBackendHealth, type BackendHealth } from '../lib/qantaraApi';
import { useSeo } from '../lib/useSeo';
import { Atmosphere } from '../components/public/landing/parts';

type ReadyState = {
  ready: boolean;
  db: string;
  migration?: string | null;
  rpc: boolean;
};

export function Status() {
  useSeo({
    title: 'System status',
    description: 'Live operational status for Qantara — backend, database, QIE RPC, and indexer readiness. Payment status, receipts, and balances are never simulated here.',
  });
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthResult, readyResult] = await Promise.allSettled([
        getBackendHealth(),
        fetch(`${QANTARA_BACKEND_URL}/v1/ready`).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) return { ...body, ready: false } as ReadyState;
          return body as ReadyState;
        }),
      ]);

      if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
      else throw healthResult.reason;

      if (readyResult.status === 'fulfilled') setReady(readyResult.value);
      else setReady(null);
    } catch (err) {
      setHealth(null);
      setReady(null);
      setError(err instanceof Error ? err.message : 'Status check failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const operationalOk = Boolean(health?.ok && health?.db === 'ok' && health?.rpc?.ok && (ready?.ready ?? true));
  const statusLabel = loading
    ? 'Checking'
    : error
      ? 'Unavailable'
      : operationalOk
        ? 'Operational'
        : 'Degraded';

  return (
    <main className="relative min-h-screen overflow-hidden px-6 pb-20 pt-14 font-body text-white">
      <Atmosphere />
      <section className="relative mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.28em] text-primary">System status</p>
            <h1 className="mt-3 font-display text-4xl font-black tracking-tight text-glow md:text-6xl">Qantara status</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-text-secondary md:text-base">
              Live operational checks from the configured backend. Payment status, receipts, and wallet balances are never simulated here.
            </p>
          </div>
          <Button variant="secondary" className="gap-2" loading={loading} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        <div className={`mt-8 rounded-2xl border p-5 ${operationalOk ? 'border-primary/30 bg-primary/10' : error ? 'border-red-500/30 bg-red-500/10' : 'border-yellow-400/30 bg-yellow-400/10'}`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              {operationalOk ? <CheckCircle className="h-6 w-6 text-primary" /> : <AlertTriangle className="h-6 w-6 text-yellow-300" />}
              <div>
                <div className="text-lg font-bold">{statusLabel}</div>
                <div className="text-sm text-text-secondary">
                  {error || health?.operational?.alerts?.[0]?.message || 'Backend health, database, RPC, and readiness are checked from live endpoints.'}
                </div>
              </div>
            </div>
            <code className="truncate rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-text-secondary">
              {QANTARA_BACKEND_URL || 'backend URL not configured'}
            </code>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatusTile
            icon={Server}
            label="Backend"
            value={health?.ok ? `online - ${health.version}` : loading ? 'checking' : 'unavailable'}
            ok={Boolean(health?.ok)}
          />
          <StatusTile
            icon={Database}
            label="Database"
            value={health?.db || (loading ? 'checking' : 'unknown')}
            ok={health?.db === 'ok'}
          />
          <StatusTile
            icon={Wifi}
            label="QIE RPC"
            value={health?.rpc?.ok ? `chain ${health.rpc.chainId} - block ${health.rpc.blockNumber}` : health?.rpc?.error || (loading ? 'checking' : 'not ready')}
            ok={Boolean(health?.rpc?.ok)}
          />
          <StatusTile
            icon={Activity}
            label="Readiness"
            value={ready?.ready ? 'ready' : ready ? 'not ready' : loading ? 'checking' : 'unknown'}
            ok={Boolean(ready?.ready)}
          />
        </div>

        <section className="mt-8 rounded-2xl border border-border-default bg-surface-1 p-5">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h2 className="text-base font-bold">Runtime details</h2>
          </div>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <InfoLine label="Environment" value={health?.env || 'not reported'} />
            <InfoLine label="Uptime" value={health ? `${health.uptime_seconds}s` : 'not reported'} />
            <InfoLine label="Invoices" value={health ? String(health.invoices) : 'not reported'} />
            <InfoLine label="Persistence" value={health?.persistence || 'not reported'} />
            <InfoLine label="Migration" value={ready?.migration || health?.migrations?.current || 'not reported'} />
            <InfoLine label="Indexer" value={health?.indexer?.configured ? `${health.indexer.cursors[0]?.lastBlock || 0}` : 'contract not configured'} />
          </div>
        </section>
      </section>
    </main>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: typeof Server;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className={`rounded-2xl border bg-surface-1 p-5 ${ok ? 'border-primary/30' : 'border-border-default'}`}>
      <Icon className={`mb-4 h-5 w-5 ${ok ? 'text-primary' : 'text-text-muted'}`} />
      <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</div>
      <div className={`mt-2 min-h-10 text-sm font-semibold ${ok ? 'text-white' : 'text-text-secondary'}`}>{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-2 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</div>
      <div className="mt-1 break-words text-sm text-text-secondary">{value}</div>
    </div>
  );
}
