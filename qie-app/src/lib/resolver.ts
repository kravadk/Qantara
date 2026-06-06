import type { Address } from 'viem';
import { QANTARA_BACKEND_URL } from './dealRoom';

export type ResolveSource = 'address' | 'ens' | 'lens' | 'farcaster' | 'telegram';

export interface ResolveResult {
  address: Address;
  source: ResolveSource;
  displayName: string;
  avatar?: string;
}

export interface ResolveResponse {
  ok: boolean;
  result?: ResolveResult;
  error?: string;
}

const inflightCache = new Map<string, Promise<ResolveResponse>>();
const valueCache = new Map<string, { at: number; value: ResolveResponse }>();
const TTL_MS = 60_000;

/**
 * Resolve a free-form handle into an address via the backend.
 *
 *   '0x...'           → returned as-is (no network call)
 *   'vitalik.eth'     → ENS
 *   'handle.lens'     → Lens
 *   'username'        → Farcaster, then Telegram
 *
 * Results cached client-side for 60s; in-flight de-duped per query.
 */
export async function resolveHandle(raw: string): Promise<ResolveResponse> {
  const q = raw.trim();
  if (!q) return { ok: false, error: 'empty' };

  const cached = valueCache.get(q);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const inflight = inflightCache.get(q);
  if (inflight) return inflight;

  const p = (async (): Promise<ResolveResponse> => {
    try {
      const r = await fetch(`${QANTARA_BACKEND_URL}/v1/resolve?q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as ResolveResponse;
      valueCache.set(q, { at: Date.now(), value: j });
      return j;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'fetch_failed' };
    } finally {
      inflightCache.delete(q);
    }
  })();

  inflightCache.set(q, p);
  return p;
}
