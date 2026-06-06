import type { Page } from '@playwright/test';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  hexToBytes,
  http,
  numberToHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { e2eEnv } from './env';

type WalletRole = 'merchant' | 'payer';

interface WalletState {
  role: WalletRole;
  currentChainId: number;
  spentWei: bigint;
  rejectNext: Set<string>;
}

function chain() {
  return defineChain({
    id: e2eEnv.chainId,
    name: e2eEnv.chainName,
    nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
    rpcUrls: { default: { http: [e2eEnv.rpcUrl] } },
    blockExplorers: { default: { name: 'QIE Explorer', url: e2eEnv.explorerUrl } },
  });
}

function accountFor(role: WalletRole) {
  const key = role === 'merchant' ? e2eEnv.merchantPrivateKey : e2eEnv.payerPrivateKey;
  if (!key) throw new Error(`Missing E2E_${role.toUpperCase()}_PRIVATE_KEY`);
  return privateKeyToAccount(key);
}

function normalizeSignMessage(message: unknown) {
  if (typeof message !== 'string') throw new Error('personal_sign message must be a string');
  return message.startsWith('0x') ? { raw: hexToBytes(message as Hex) } : message;
}

export async function installE2EWallet(page: Page, role: WalletRole, options: { initialChainId?: number } = {}) {
  const account = accountFor(role);
  const publicClient = createPublicClient({ chain: chain(), transport: http(e2eEnv.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: chain(), transport: http(e2eEnv.rpcUrl) });
  const state: WalletState = {
    role,
    currentChainId: options.initialChainId ?? e2eEnv.chainId,
    spentWei: 0n,
    rejectNext: new Set(),
  };

  await page.exposeBinding('__qieE2eWalletRpc', async (_source, request: { method: string; params?: unknown[] }) => {
    const method = request.method;
    const params = request.params ?? [];
    if (state.rejectNext.has(method)) {
      state.rejectNext.delete(method);
      const error = new Error(`${method} rejected by E2E wallet`);
      (error as any).code = 4001;
      throw error;
    }

    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address];
      case 'eth_chainId':
        return numberToHex(state.currentChainId);
      case 'wallet_switchEthereumChain': {
        const next = params[0] as { chainId?: Hex } | undefined;
        if (!next?.chainId) throw new Error('wallet_switchEthereumChain requires chainId');
        state.currentChainId = Number(BigInt(next.chainId));
        return null;
      }
      case 'personal_sign': {
        const [message] = params;
        return account.signMessage({ message: normalizeSignMessage(message) as any });
      }
      case 'eth_signTypedData_v4': {
        const [, typedData] = params;
        const parsed = typeof typedData === 'string' ? JSON.parse(typedData) : typedData;
        return account.signTypedData(parsed as any);
      }
      case 'eth_sendTransaction': {
        if (!e2eEnv.allowRealTx) {
          throw new Error('E2E_ALLOW_REAL_TX=true is required before sending real transactions');
        }
        if (state.currentChainId !== e2eEnv.chainId) {
          throw new Error(`Wrong chain ${state.currentChainId}; expected ${e2eEnv.chainId}`);
        }
        const tx = params[0] as {
          to?: Address;
          value?: Hex;
          data?: Hex;
          gas?: Hex;
          maxFeePerGas?: Hex;
          maxPriorityFeePerGas?: Hex;
          gasPrice?: Hex;
        };
        const value = tx.value ? BigInt(tx.value) : 0n;
        if (state.spentWei + value > e2eEnv.maxSpendWei) {
          throw new Error(`E2E spend cap exceeded: ${formatEther(state.spentWei + value)} QIE`);
        }
        const hash = await walletClient.sendTransaction({
          account,
          chain: chain(),
          to: tx.to,
          value,
          data: tx.data,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
          gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
          maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
        } as any);
        state.spentWei += value;
        return hash;
      }
      default:
        return publicClient.request({ method: method as any, params: params as any });
    }
  });

  await page.exposeBinding('__qieE2eRejectNextWalletMethod', async (_source, method: string) => {
    state.rejectNext.add(method);
  });

  await page.addInitScript(({ address, initialChainId }) => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    let currentChainId = initialChainId;
    const emit = (event: string, payload: unknown) => {
      for (const cb of listeners.get(event) ?? []) cb(payload);
    };
    const provider = {
      isQieWallet: true,
      isMetaMask: true,
      selectedAddress: address,
      chainId: `0x${currentChainId.toString(16)}`,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const result = await (window as any).__qieE2eWalletRpc({ method, params });
        if (method === 'wallet_switchEthereumChain') {
          currentChainId = Number(BigInt((params?.[0] as any)?.chainId));
          provider.chainId = `0x${currentChainId.toString(16)}`;
          emit('chainChanged', provider.chainId);
        }
        if (method === 'eth_requestAccounts') emit('accountsChanged', [address]);
        return result;
      },
      on: (event: string, cb: (...args: any[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      },
      removeListener: (event: string, cb: (...args: any[]) => void) => {
        listeners.get(event)?.delete(cb);
      },
      off: (event: string, cb: (...args: any[]) => void) => {
        listeners.get(event)?.delete(cb);
      },
    };
    Object.defineProperty(window, 'ethereum', {
      value: provider,
      configurable: true,
    });
    (window as any).__qieE2eRejectNext = (method: string) => (window as any).__qieE2eRejectNextWalletMethod(method);
  }, { address: account.address, initialChainId: state.currentChainId });

  return { address: account.address, publicClient };
}
