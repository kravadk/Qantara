import { useEffect, useMemo, useState } from 'react';
import {
  getBackendHealth,
  getPaymentRailCatalog,
  type BackendHealth,
  type PaymentRailCatalog,
} from '../../lib/qantaraApi';
import { getExplorerStats, type ExplorerStats } from '../../lib/api/explorerApi';
import { getQieEcosystem, getQieNetworkCatalog, type QieEcosystem, type QieNetworkCatalog } from '../../lib/api/qieApi';

export interface PublicSignals {
  loading: boolean;
  degraded: boolean;
  health: BackendHealth | null;
  rails: PaymentRailCatalog | null;
  networkCatalog: QieNetworkCatalog | null;
  ecosystem: QieEcosystem | null;
  stats: ExplorerStats | null;
  errors: string[];
}

export function usePublicSignals(): PublicSignals {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [rails, setRails] = useState<PaymentRailCatalog | null>(null);
  const [networkCatalog, setNetworkCatalog] = useState<QieNetworkCatalog | null>(null);
  const [ecosystem, setEcosystem] = useState<QieEcosystem | null>(null);
  const [stats, setStats] = useState<ExplorerStats | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const results = await Promise.allSettled([
        getBackendHealth(),
        getPaymentRailCatalog(),
        getQieNetworkCatalog(),
        getQieEcosystem(),
        getExplorerStats(),
      ]);
      if (!active) return;
      const nextErrors: string[] = [];
      const unwrap = <T,>(result: PromiseSettledResult<T>, label: string): T | null => {
        if (result.status === 'fulfilled') return result.value;
        nextErrors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : 'unavailable'}`);
        return null;
      };
      setHealth(unwrap(results[0], 'health'));
      setRails(unwrap(results[1], 'rails'));
      setNetworkCatalog(unwrap(results[2], 'network catalog'));
      setEcosystem(unwrap(results[3], 'ecosystem'));
      setStats(unwrap(results[4], 'explorer stats'));
      setErrors(nextErrors);
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return useMemo(() => ({
    loading,
    degraded: errors.length > 0 || health?.ok === false,
    health,
    rails,
    networkCatalog,
    ecosystem,
    stats,
    errors,
  }), [ecosystem, errors, health, loading, networkCatalog, rails, stats]);
}

export function formatPublicMetric(value: number | undefined | null): string {
  if (value === undefined || value === null) return 'Unavailable';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}
