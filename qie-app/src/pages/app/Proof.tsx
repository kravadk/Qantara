import { motion } from 'framer-motion';
import { CheckCircle2, Copy, ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { qieMainnet } from '../../config/wagmi';
import { getDeploymentStatus, type DeploymentRegistryStatus } from '../../lib/qantaraApi';

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function Proof() {
  const [registry, setRegistry] = useState<DeploymentRegistryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToastStore();

  useEffect(() => {
    void getDeploymentStatus()
      .then((value) => {
        setRegistry(value);
        setError(null);
      })
      .catch((err) => {
        setRegistry(null);
        setError(err instanceof Error ? err.message : 'Deployment registry unavailable');
      });
  }, []);

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    addToast('success', `${label} copied`);
  };

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">Deployment Proof</h1>
        <p className="text-text-secondary">
          Production contract addresses and verification status from the connected backend registry.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1 text-xs text-text-secondary">
          <p>
            Settlement state is accepted only after QIE RPC verification or indexed invoice contract events.
          </p>
          <p>
            Network: <span className="font-bold text-white">QIE Mainnet</span> · chain {qieMainnet.id}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-4 text-sm text-yellow-200">
          {error}
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Summary label="Registry" value={registry?.ok ? 'Healthy' : 'Needs setup'} ok={registry?.ok} />
          <Summary label="Required contracts" value={registry?.requiredConfigured ? 'Configured' : 'Check env'} ok={registry?.requiredConfigured} />
          <Summary label="Release" value={registry?.release ?? 'Waiting'} ok={Boolean(registry?.release)} />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-1">
          {(registry?.contracts ?? []).map((contract, index) => (
            <div
              key={contract.key}
              className={`flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between ${index > 0 ? 'border-t border-border-default' : ''}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-white">{contract.label}</p>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase text-text-muted">
                    {contract.version}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-text-muted">{contract.address}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${contract.status === 'configured' ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'}`}>
                  {contract.status.replace('_', ' ')}
                </span>
                {contract.verified && (
                  <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase text-primary">verified</span>
                )}
                <button
                  type="button"
                  onClick={() => copy(contract.address, contract.label)}
                  className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-primary"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <a
                  href={`${qieMainnet.blockExplorers.default.url}/address/${contract.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-primary"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>

        <Button variant="secondary" className="gap-2" onClick={() => copy('/v1/deployments/status', 'Registry endpoint')}>
          <Copy className="h-4 w-4" /> Copy registry endpoint
        </Button>
      </motion.div>
    </div>
  );
}

function Summary({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</p>
        {ok && <CheckCircle2 className="h-4 w-4 text-primary" />}
      </div>
      <p className={`mt-3 text-lg font-bold ${ok ? 'text-primary' : 'text-white'}`}>{value}</p>
      {label === 'Registry' && registryAddressHint()}
    </div>
  );
}

function registryAddressHint() {
  return <p className="mt-1 text-xs text-text-muted">Addresses resolve from backend configuration.</p>;
}
