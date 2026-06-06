import type { Address } from 'viem';
import { parseJson, QANTARA_BACKEND_URL } from './http';

export interface QieRpcCandidate {
  url: string;
  label: string;
  preferred: boolean;
  source: 'official_docs' | 'env';
}

export interface QieNetworkCatalogEntry {
  key: 'qie-mainnet' | 'qie-testnet';
  name: string;
  chainId: number;
  chainIdHex: string;
  symbol: string;
  nativeCurrency: { name: string; symbol: string; decimals: 18 };
  rpcUrls: QieRpcCandidate[];
  explorer: {
    baseUrl: string;
    txUrlTemplate: string;
    addressUrlTemplate: string;
  };
  faucetUrl: string | null;
  docsUrl: string;
  walletAddNetwork: {
    chainId: string;
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: 18 };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
}

export interface QieNetworkCatalog {
  ok: boolean;
  source: string;
  activeNetwork: string;
  networks: QieNetworkCatalogEntry[];
  generatedAt: number;
}

export interface QieEcosystemLink {
  id: string;
  name: string;
  url: string;
  category: 'wallet' | 'identity' | 'network' | 'defi' | 'developer';
  availability: 'available' | 'not_configured';
  reason: string;
}

export interface QieEcosystem {
  ok: boolean;
  source: string;
  links: QieEcosystemLink[];
  generatedAt: number;
}

export interface AcquisitionRoute {
  id: string;
  label: string;
  tokenSymbol: 'QIE' | 'QUSDC';
  state: 'available' | 'disabled';
  reason: string;
  actionType: 'external_link' | 'contract_mint';
  url: string | null;
  requiresRealTx: true;
  source: 'qie_ecosystem_registry' | 'qusdc_vault_config';
  metadata?: Record<string, string | null>;
}

export interface QieLendingMarket {
  symbol: 'WBNB' | 'WETH' | 'QUSDC' | 'WQIE';
  cToken: Address;
  underlying: Address;
  decimals: 18 | 6;
  source: string;
  totals: { supply: string | null; borrow: string | null };
  portfolio: { address: Address; supplied: string | null; borrowed: string | null } | null;
  status: 'available' | 'degraded';
  error: string | null;
}

export interface QieLendingStatus {
  ok: boolean;
  source: string;
  chainId: number;
  comptroller: Address;
  address: Address | null;
  markets: QieLendingMarket[];
  generatedAt: number;
}

export async function getQieNetworkCatalog(): Promise<QieNetworkCatalog> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/qie/network-catalog`);
  return parseJson<QieNetworkCatalog>(res);
}

export async function getQieEcosystem(): Promise<QieEcosystem> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/qie/ecosystem`);
  return parseJson<QieEcosystem>(res);
}

export async function getQieLendingStatus(address?: string): Promise<QieLendingStatus> {
  const url = new URL(`${QANTARA_BACKEND_URL}/v1/qie/lending/status`);
  if (address) url.searchParams.set('address', address);
  const res = await fetch(url.toString());
  return parseJson<QieLendingStatus>(res);
}
