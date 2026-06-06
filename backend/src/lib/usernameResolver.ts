import { createPublicClient, http, isAddress, getAddress, type Address } from 'viem';
import { mainnet } from 'viem/chains';

/**
 * Username resolver — multi-source lookup of human-readable handles to 0x address.
 *
 * Lookup order (first hit wins):
 *  1. Raw 0x address — returned as-is.
 *  2. .eth name — resolved on Ethereum mainnet via viem.
 *  3. .lens handle — Lens v2 API (api-v2.lens.dev).
 *  4. Farcaster @handle — Warpcast public API.
 *  5. Telegram @handle — internal `tg_user_addresses` table (populated by tg-bot).
 *
 * Returns `null` if nothing matched. Throws only on programmer error.
 */

export type ResolveSource = 'address' | 'ens' | 'lens' | 'farcaster' | 'telegram';

export interface ResolveResult {
  address: Address;
  source: ResolveSource;
  displayName: string;
  avatar?: string;
}

const ENS_TIMEOUT_MS = 4_000;
const LENS_TIMEOUT_MS = 3_000;
const FARCASTER_TIMEOUT_MS = 3_000;

// Fallback list of free public Ethereum RPCs (used only for ENS resolution, not money flow).
// Cycled on failure inside resolveEns. llamarpc was unreachable from some regions, so it's removed.
const ETH_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://cloudflare-eth.com',
];

function makeEnsClient(url: string) {
  return createPublicClient({ chain: mainnet, transport: http(url, { timeout: 4_000 }) });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function resolveEns(name: string): Promise<ResolveResult | null> {
  for (const url of ETH_RPCS) {
    try {
      const client = makeEnsClient(url);
      const address = await withTimeout(client.getEnsAddress({ name }), ENS_TIMEOUT_MS);
      if (!address) continue;
      let avatar: string | undefined;
      try {
        avatar = (await withTimeout(client.getEnsAvatar({ name }), ENS_TIMEOUT_MS)) ?? undefined;
      } catch {
        avatar = undefined;
      }
      return { address, source: 'ens', displayName: name, avatar };
    } catch {
      // try next RPC
    }
  }
  return null;
}

async function resolveLens(handle: string): Promise<ResolveResult | null> {
  const normalized = handle.endsWith('.lens') ? handle.slice(0, -5) : handle;
  const query = JSON.stringify({
    query: `query Profile($handle: Handle!) { profile(request: { forHandle: $handle }) { ownedBy { address } metadata { picture { ... on ImageSet { raw { uri } } } } } }`,
    variables: { handle: `lens/${normalized}` },
  });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), LENS_TIMEOUT_MS);
    const r = await fetch('https://api-v2.lens.dev/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: query,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const addr = j?.data?.profile?.ownedBy?.address;
    if (!addr || !isAddress(addr)) return null;
    const avatar = j?.data?.profile?.metadata?.picture?.raw?.uri;
    return { address: getAddress(addr), source: 'lens', displayName: `${normalized}.lens`, avatar };
  } catch {
    return null;
  }
}

async function resolveFarcaster(handle: string): Promise<ResolveResult | null> {
  const username = handle.replace(/^@/, '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FARCASTER_TIMEOUT_MS);
    const r = await fetch(
      `https://api.warpcast.com/v2/user-by-username?username=${encodeURIComponent(username)}`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const user = j?.result?.user;
    const addr =
      user?.verifications?.[0] ||
      user?.custodyAddress;
    if (!addr || !isAddress(addr)) return null;
    return {
      address: getAddress(addr),
      source: 'farcaster',
      displayName: `@${username}`,
      avatar: user?.pfp?.url,
    };
  } catch {
    return null;
  }
}

/**
 * Internal Telegram handle lookup. Reads from a caller-provided lookup function so
 * this module stays storage-agnostic (the bot owns the SQLite table).
 */
async function resolveTelegram(
  handle: string,
  tgLookup?: (h: string) => Address | null,
): Promise<ResolveResult | null> {
  if (!tgLookup) return null;
  const username = handle.replace(/^@/, '').replace(/^t\.me\//, '');
  const addr = tgLookup(username);
  if (!addr) return null;
  return { address: addr, source: 'telegram', displayName: `@${username}` };
}

/**
 * Resolve a free-form query into an address.
 *
 * Heuristic dispatch by query shape:
 *   0x...               → raw address (no network call)
 *   anything.eth        → ENS
 *   anything.lens       → Lens
 *   bare word           → tries Farcaster, then Telegram
 */
export async function resolveUsername(
  raw: string,
  opts?: { tgLookup?: (h: string) => Address | null },
): Promise<ResolveResult | null> {
  const q = raw.trim();
  if (!q) return null;

  if (isAddress(q)) {
    return { address: getAddress(q), source: 'address', displayName: q };
  }

  if (q.endsWith('.eth')) {
    return await resolveEns(q);
  }

  if (q.endsWith('.lens')) {
    return await resolveLens(q);
  }

  const stripped = q.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(stripped)) return null;

  const fc = await resolveFarcaster(stripped);
  if (fc) return fc;

  const tg = await resolveTelegram(stripped, opts?.tgLookup);
  if (tg) return tg;

  return null;
}
