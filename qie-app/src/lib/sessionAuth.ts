import type { Address } from 'viem';

export const SIWE_TOKEN_KEY = 'qantara-siwe-token';
export const SIWE_ADDR_KEY = 'qantara-siwe-address';

const LEGACY_SIWE_TOKEN_KEY = 'qantara-siwe-token';
const LEGACY_SIWE_ADDR_KEY = 'qantara-siwe-address';

export function readStoredSession(): { token: string; address: Address } | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem(SIWE_TOKEN_KEY) ?? window.localStorage.getItem(LEGACY_SIWE_TOKEN_KEY);
  const address = window.localStorage.getItem(SIWE_ADDR_KEY) ?? window.localStorage.getItem(LEGACY_SIWE_ADDR_KEY);
  if (!token || !address) return null;
  if (!window.localStorage.getItem(SIWE_TOKEN_KEY)) {
    window.localStorage.setItem(SIWE_TOKEN_KEY, token);
    window.localStorage.setItem(SIWE_ADDR_KEY, address);
  }
  return { token, address: address as Address };
}

export function getStoredSiweToken(): string | null {
  return readStoredSession()?.token ?? null;
}

export function getStoredSiweAddress(): Address | null {
  return readStoredSession()?.address ?? null;
}

export function storeSiweSession(session: { token: string; address: Address }) {
  window.localStorage.setItem(SIWE_TOKEN_KEY, session.token);
  window.localStorage.setItem(SIWE_ADDR_KEY, session.address);
}

export function clearSiweSession() {
  window.localStorage.removeItem(SIWE_TOKEN_KEY);
  window.localStorage.removeItem(SIWE_ADDR_KEY);
  window.localStorage.removeItem(LEGACY_SIWE_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_SIWE_ADDR_KEY);
}
