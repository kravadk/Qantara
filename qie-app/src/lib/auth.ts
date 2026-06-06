import { useCallback, useEffect, useState } from 'react';
import { useAccount, useChainId, useSignMessage } from 'wagmi';
import type { Address } from 'viem';
import { QANTARA_BACKEND_URL } from './dealRoom';
import { clearSiweSession, readStoredSession, storeSiweSession } from './sessionAuth';

export type SiweStatus = 'idle' | 'signing' | 'verifying' | 'ok' | 'error';

function buildSiweMessage(input: {
  domain: string;
  address: Address;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}) {
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    '',
    input.statement,
    '',
    `URI: ${input.uri}`,
    'Version: 1',
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join('\n');
}

/**
 * SIWE (Sign-In With Ethereum) auth hook against the backend.
 *
 *   1. GET /v1/auth/nonce              → server-issued nonce
 *   2. buildSiweMessage()              → canonical EIP-4361 string
 *   3. wagmi signMessageAsync()        → wallet popup
 *   4. POST /v1/auth/verify            → server verifies + JWT
 *   5. localStorage persists session across reloads
 *
 * `authFetch(input, init)` automatically attaches `Authorization: Bearer <token>`.
 */
export function useSiweAuth() {
  const { address: walletAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<SiweStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ token: string; address: Address } | null>(
    readStoredSession,
  );

  useEffect(() => {
    if (!session) return;
    if (!walletAddress || walletAddress.toLowerCase() !== session.address.toLowerCase()) {
      clearSiweSession();
      setSession(null);
    }
  }, [walletAddress, session]);

  const login = useCallback(async (): Promise<boolean> => {
    if (!isConnected || !walletAddress) {
      setError('wallet_not_connected');
      setStatus('error');
      return false;
    }
    setError(null);
    setStatus('signing');
    try {
      const nonceRes = await fetch(`${QANTARA_BACKEND_URL}/v1/auth/nonce`);
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const prepared = buildSiweMessage({
        domain: window.location.host,
        address: walletAddress,
        statement: 'Sign in to Qantara',
        uri: window.location.origin,
        chainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const signature = await signMessageAsync({ account: walletAddress, message: prepared });

      setStatus('verifying');
      const verifyRes = await fetch(`${QANTARA_BACKEND_URL}/v1/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: prepared, signature }),
      });
      const verifyJson = (await verifyRes.json()) as
        | { ok: true; token: string; address: Address }
        | { ok?: false; error: string };
      if (!verifyRes.ok || !('ok' in verifyJson) || !verifyJson.ok) {
        const m = 'error' in verifyJson ? verifyJson.error : 'verify_failed';
        setError(m);
        setStatus('error');
        return false;
      }

      storeSiweSession({ token: verifyJson.token, address: verifyJson.address });
      setSession({ token: verifyJson.token, address: verifyJson.address });
      setStatus('ok');
      return true;
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'sign_failed');
      setStatus('error');
      return false;
    }
  }, [isConnected, walletAddress, chainId, signMessageAsync]);

  const logout = useCallback(() => {
    clearSiweSession();
    setSession(null);
    setStatus('idle');
    setError(null);
  }, []);

  const authFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (session?.token) headers.set('Authorization', `Bearer ${session.token}`);
      return fetch(input, { ...init, headers });
    },
    [session?.token],
  );

  return {
    address: session?.address ?? null,
    token: session?.token ?? null,
    isAuthenticated: !!session,
    status,
    error,
    login,
    logout,
    authFetch,
  };
}
