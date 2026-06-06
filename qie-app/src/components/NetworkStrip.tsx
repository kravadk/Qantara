import { useEffect, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { qieMainnet } from '../config/wagmi';
import { getBackendHealth } from '../lib/qantaraApi';
import { getQieNetworkCatalog, type QieNetworkCatalog } from '../lib/api/qieApi';

const TARGET_CHAIN_ID = qieMainnet.id;

export function NetworkStrip() {
  const [catalog, setCatalog] = useState<QieNetworkCatalog | null>(null);
  const [rpcLabel, setRpcLabel] = useState('checking backend RPC');
  const [isOnline, setIsOnline] = useState(true);
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const isWrongNetwork = isConnected && chainId !== undefined && chainId !== TARGET_CHAIN_ID;

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const [health, networkCatalog] = await Promise.all([
          getBackendHealth(),
          getQieNetworkCatalog(),
        ]);
        if (cancelled) return;
        setCatalog(networkCatalog);
        if (health.rpc?.ok) {
          setRpcLabel(`QIE Mainnet · block ${health.rpc.blockNumber ?? 'unknown'}`);
          setIsOnline(true);
        } else {
          setRpcLabel(health.rpc?.error || 'backend RPC not verified');
          setIsOnline(false);
        }
      } catch (err) {
        if (!cancelled) {
          setRpcLabel(err instanceof Error ? err.message : 'backend unavailable');
          setIsOnline(false);
        }
      }
    };

    void refresh();
    const interval = setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const active = catalog?.networks.find((network) => network.key === catalog.activeNetwork) ?? catalog?.networks[0] ?? null;
  const stripColor = !isOnline ? 'bg-red-500' : isWrongNetwork ? 'bg-yellow-500' : 'bg-primary';
  const dotColor = !isOnline ? 'bg-red-500' : isWrongNetwork ? 'bg-yellow-500' : 'bg-primary';

  const label = !isOnline
    ? `Network health unavailable - ${rpcLabel}`
    : isWrongNetwork
      ? 'Wrong network - switch to QIE Mainnet'
      : `${rpcLabel} · ${active?.rpcUrls.length ?? 0} RPC candidates`;

  return (
    <div className={`fixed left-0 right-0 top-0 z-[10007] h-[2px] transition-colors duration-500 ${stripColor}`}>
      <div className="absolute right-8 top-0 flex items-center gap-2 rounded-b-lg border-x border-b border-border-default bg-bg-base/80 px-3 py-1 backdrop-blur-md">
        <div className={`h-1.5 w-1.5 rounded-full animate-pulse ${dotColor}`} />
        <span className="text-xs font-bold uppercase tracking-widest text-text-secondary">
          {label}
        </span>
        {active && (
          <a href={active.explorer.baseUrl} target="_blank" rel="noreferrer" className="ml-1 text-xs font-bold text-primary hover:underline">
            Explorer
          </a>
        )}
        {isWrongNetwork && (
          <button
            onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
            className="ml-1 text-xs font-bold text-yellow-400 underline hover:text-yellow-300"
          >
            Switch
          </button>
        )}
      </div>
    </div>
  );
}
