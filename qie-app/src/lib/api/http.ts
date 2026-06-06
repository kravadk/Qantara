/**
 * Shared HTTP primitives for the Qantara frontend API modules.
 * Domain modules under lib/api/* import from here to avoid a monolith and cycles.
 */
import { getStoredSiweToken } from '../sessionAuth';

export { QANTARA_BACKEND_URL } from '../dealRoom';

export async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any).message || (body as any).error || `HTTP ${res.status}`);
  }
  return body as T;
}

/** First non-null value among the given keys (tolerant backend field-name parsing). */
export function getField<T>(value: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key] as T;
  }
  return undefined;
}

/** Deep key-sorted clone for canonical JSON signing payloads. */
export function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sorted((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export class MerchantAuthMissingError extends Error {
  constructor() {
    super('Sign in with a merchant wallet');
    this.name = 'MerchantAuthMissingError';
  }
}

/** Authenticated headers (SIWE session). Throws MerchantAuthMissingError when signed out. */
export function operationalHeaders(): HeadersInit {
  const token = getStoredSiweToken();
  if (!token) throw new MerchantAuthMissingError();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function merchantActionHeaders(): HeadersInit {
  const token = getStoredSiweToken();
  if (!token) throw new MerchantAuthMissingError();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/** True when a merchant SIWE session is stored (browser-side auth gate). */
export function hasMerchantAuth(): boolean {
  return !!getStoredSiweToken();
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function numberField(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
