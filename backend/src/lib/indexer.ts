import type { Server } from 'node:http';
import { optionalEnv } from './env.js';
import { syncQantaraContractEvents } from './chain.js';

let timer: NodeJS.Timeout | undefined;
let running = false;
let lastError: string | undefined;
let lastRunAt: number | undefined;

export function indexerRuntimeStatus() {
  return {
    enabled: !!timer,
    running,
    lastRunAt,
    lastError,
    intervalMs: Number(optionalEnv('CHAIN_INDEXER_INTERVAL_MS') ?? '15000'),
  };
}

export function startChainIndexer(server?: Server): void {
  if (optionalEnv('CHAIN_INDEXER_DISABLED') === 'true') return;
  const contractAddress = optionalEnv('QANTARA_ADDRESS');
  if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) return;
  if (timer) return;

  const intervalMs = Math.max(5_000, Number(optionalEnv('CHAIN_INDEXER_INTERVAL_MS') ?? '15000'));
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncQantaraContractEvents({ contractAddress: contractAddress as `0x${string}` });
      lastRunAt = Math.floor(Date.now() / 1000);
      lastError = undefined;
    } catch (err: any) {
      lastError = err?.message ?? 'chain indexer failed';
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();

  server?.on('close', () => stopChainIndexer());
}

export function stopChainIndexer(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
