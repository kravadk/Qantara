/**
 * Frontend client for gasless meta-transactions via QantaraGasRelay.
 *
 * Flow: the user signs an EIP-712 ForwardRequest in their wallet (no gas), the
 * backend `/v1/relay/sponsor` endpoint submits `relay.execute()` and the relayer
 * wallet pays the gas. The target contract must be ERC-2771-aware so the call is
 * still attributed on-chain to the signer (see QantaraChat2771).
 *
 * The EIP-712 domain NAME is read live from the contract (`eip712Domain()`) — the
 * deployed relay carries a legacy pre-rebrand name, so hardcoding it would produce
 * signatures the contract cannot verify.
 */
import type { Address, Hex, PublicClient } from 'viem';
import { QANTARA_BACKEND_URL } from './dealRoom';
import { qieMainnet } from '../config/wagmi';

export const QANTARA_GAS_RELAY_ADDRESS =
  (import.meta.env.VITE_QANTARA_GAS_RELAY_ADDRESS as Address | undefined) ??
  '0xE027abFb3F845c6798fA247f1053Bd1B143768d2';

const relayReadAbi = [
  { type: 'function', stateMutability: 'view', name: 'nonces', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function', stateMutability: 'view', name: 'eip712Domain', inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' }, { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' }, { name: 'extensions', type: 'uint256[]' },
    ],
  },
] as const;

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

export interface ForwardRequest {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  deadline: bigint;
  data: Hex;
}

export interface SignTypedDataFn {
  (args: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address };
    types: typeof FORWARD_REQUEST_TYPES;
    primaryType: 'ForwardRequest';
    message: ForwardRequest;
  }): Promise<Hex>;
}

/** Build the ForwardRequest + the EIP-712 domain (name read from the live relay). */
export async function buildForwardRequest(
  publicClient: PublicClient,
  params: { from: Address; to: Address; data: Hex; gas?: bigint; value?: bigint; ttlSeconds?: number; nowMs: number },
): Promise<{ request: ForwardRequest; domain: { name: string; version: string; chainId: number; verifyingContract: Address }; types: typeof FORWARD_REQUEST_TYPES }> {
  const [nonce, domainTuple] = await Promise.all([
    publicClient.readContract({ address: QANTARA_GAS_RELAY_ADDRESS, abi: relayReadAbi, functionName: 'nonces', args: [params.from] } as never) as Promise<bigint>,
    publicClient.readContract({ address: QANTARA_GAS_RELAY_ADDRESS, abi: relayReadAbi, functionName: 'eip712Domain' } as never) as Promise<readonly unknown[]>,
  ]);
  const domainName = String(domainTuple[1]);
  const deadline = BigInt(Math.floor(params.nowMs / 1000) + (params.ttlSeconds ?? 3600));
  const request: ForwardRequest = {
    from: params.from,
    to: params.to,
    value: params.value ?? 0n,
    gas: params.gas ?? 500000n,
    nonce,
    deadline,
    data: params.data,
  };
  return {
    request,
    domain: { name: domainName, version: '1', chainId: qieMainnet.id, verifyingContract: QANTARA_GAS_RELAY_ADDRESS },
    types: FORWARD_REQUEST_TYPES,
  };
}

export interface SponsorResult {
  txHash: Hex;
  gasUsed?: string;
}

/** POST a signed ForwardRequest to the backend relayer. Throws with a useful message. */
export async function sponsorForwardRequest(request: ForwardRequest, signature: Hex): Promise<SponsorResult> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/relay/sponsor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      forwardRequest: {
        from: request.from,
        to: request.to,
        value: request.value.toString(),
        gas: request.gas.toString(),
        nonce: request.nonce.toString(),
        deadline: Number(request.deadline),
        data: request.data,
      },
      signature,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !(body as any).ok) {
    const reason = (body as any).reason || (body as any).error || `HTTP ${res.status}`;
    throw new Error(`relay_sponsor_failed: ${reason}`);
  }
  return { txHash: (body as any).txHash as Hex, gasUsed: (body as any).gasUsed };
}

/** End-to-end: build → sign → sponsor. Returns the sponsored tx hash. */
export async function signAndSponsor(
  publicClient: PublicClient,
  signTypedData: SignTypedDataFn,
  params: { from: Address; to: Address; data: Hex; gas?: bigint; nowMs: number },
): Promise<SponsorResult> {
  const { request, domain, types } = await buildForwardRequest(publicClient, params);
  const signature = await signTypedData({ domain, types, primaryType: 'ForwardRequest', message: request });
  return sponsorForwardRequest(request, signature);
}

/** True when a gasless chat target is configured for this build. */
export function gaslessChatConfigured(chat2771: string | undefined): boolean {
  return !!chat2771 && /^0x[a-fA-F0-9]{40}$/.test(chat2771);
}
