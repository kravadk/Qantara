import { createPublicClient, fallback, getAddress, http, parseAbi, type Address } from 'viem';
import { optionalEnv } from './env.js';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const QIE_CHAIN_ID = 1990;
const QIE_TESTNET_CHAIN_ID = 1983;

const MAINNET_RPCS = [
  'https://rpc1mainnet.qie.digital',
  'https://rpc2mainnet.qie.digital',
  'https://rpc5mainnet.qie.digital',
  'https://rpc4mainnet.qie.digital',
  'https://rpc3mainnet.qie.digital',
];

const TESTNET_RPCS = [
  'https://rpc1testnet.qie.digital',
  'https://rpc2testnet.qie.digital',
  'https://rpc3testnet.qie.digital',
  'https://rpc4testnet.qie.digital',
  'https://rpc5testnet.qie.digital',
  'https://rpc6testnet.qie.digital',
];

const DEFAULT_LINKS = {
  homepage: 'https://www.qie.digital',
  wallet: 'https://qiewallet.me',
  walletExtension: 'https://chrome.google.com/webstore',
  pass: 'https://qiepass.qie.digital',
  domains: 'https://domains.qie.digital',
  explorer: 'https://mainnet.qie.digital',
  testnetExplorer: 'https://testnet.qie.digital',
  dex: 'https://www.dex.qie.digital',
  bridge: 'https://bridge.qie.digital',
  faucet: 'https://www.qie.digital/faucet',
  docs: 'https://docs.qie.digital',
  stable: 'https://www.stable.qie.digital',
  sdk: 'https://docs.qie.digital/developer-docs',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const cTokenAbi = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function totalBorrows() view returns (uint256)',
  'function balanceOfUnderlying(address owner) returns (uint256)',
  'function borrowBalanceStored(address account) view returns (uint256)',
]);

export type EcosystemAvailability = 'available' | 'not_configured';

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

export interface EcosystemLink {
  id: string;
  name: string;
  url: string;
  category: 'wallet' | 'identity' | 'network' | 'defi' | 'developer';
  availability: EcosystemAvailability;
  reason: string;
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

export interface LendingMarketConfig {
  symbol: 'WBNB' | 'WETH' | 'QUSDC' | 'WQIE';
  cToken: Address;
  underlying: Address;
  decimals: 18 | 6;
}

const LENDING_MARKETS: LendingMarketConfig[] = [
  {
    symbol: 'WBNB',
    cToken: '0xD072cDDc4e8A15EE532F7fB7AC583a3715b5261f',
    underlying: '0x9e02ba5dE6d26D5Ca5688Ed3999C6bcF4F3e966E',
    decimals: 18,
  },
  {
    symbol: 'WETH',
    cToken: '0x0b8F865dd5E822323F3B45554bdbC8De3715dA60',
    underlying: '0x95322ccB3fb8dDefD210805EE18662762a0bc4A2',
    decimals: 18,
  },
  {
    symbol: 'QUSDC',
    cToken: '0x3EcD3b3fa22Cc251301BA78F4Ba014f78B6FE542',
    underlying: '0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5',
    decimals: 6,
  },
  {
    symbol: 'WQIE',
    cToken: '0x25A9bD97C90161A622a75A4Fd87ea0e7507324CA',
    underlying: '0x0087904D95BEe9E5F24dc8852804b547981A9139',
    decimals: 18,
  },
];

function cleanUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function publicDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return 'configured-rpc';
  }
}

function publicRpcUrls(urls: string[], configured?: string | null): QieRpcCandidate[] {
  const custom = cleanUrl(configured);
  const candidates: QieRpcCandidate[] = [];
  if (custom && !urls.includes(custom)) {
    candidates.push({ url: publicDisplayUrl(custom), label: 'Configured RPC', preferred: true, source: 'env' });
  }
  urls.forEach((url, index) => {
    candidates.push({
      url,
      label: `RPC ${index + 1}`,
      preferred: !custom && index === 0,
      source: 'official_docs',
    });
  });
  return candidates;
}

export function qieRpcUrls(): string[] {
  const configured = cleanUrl(optionalEnv('QIE_RPC_URL'));
  return configured ? [configured, ...MAINNET_RPCS.filter((url) => url !== configured)] : MAINNET_RPCS;
}

export function qieRpcTransport() {
  const transports = qieRpcUrls().map((url) => http(url));
  return transports.length === 1 ? transports[0] : fallback(transports);
}

function explorerTemplates(baseUrl: string) {
  return {
    baseUrl,
    txUrlTemplate: `${baseUrl}/tx/{txHash}`,
    addressUrlTemplate: `${baseUrl}/address/{address}`,
  };
}

export function qieNetworkCatalog() {
  const mainnetExplorer = cleanUrl(optionalEnv('QIE_EXPLORER_URL') ?? optionalEnv('QIE_EXPLORER_API_URL')) ?? DEFAULT_LINKS.explorer;
  const testnetExplorer = cleanUrl(optionalEnv('QIE_TESTNET_EXPLORER_URL')) ?? DEFAULT_LINKS.testnetExplorer;
  const mainnetRpcs = publicRpcUrls(MAINNET_RPCS, optionalEnv('QIE_RPC_URL'));
  const testnetRpcs = publicRpcUrls(TESTNET_RPCS, optionalEnv('QIE_TESTNET_RPC_URL'));

  const mainnet: QieNetworkCatalogEntry = {
    key: 'qie-mainnet',
    name: 'QIE Mainnet',
    chainId: QIE_CHAIN_ID,
    chainIdHex: `0x${QIE_CHAIN_ID.toString(16)}`,
    symbol: 'QIE',
    nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
    rpcUrls: mainnetRpcs,
    explorer: explorerTemplates(mainnetExplorer),
    faucetUrl: null,
    docsUrl: 'https://docs.qie.digital/getting-started-with-qie-blockchain/4.-access-mainnet-or-testnet',
    walletAddNetwork: {
      chainId: `0x${QIE_CHAIN_ID.toString(16)}`,
      chainName: 'QIEMainnet',
      nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
      rpcUrls: mainnetRpcs.map((item) => item.url),
      blockExplorerUrls: [mainnetExplorer],
    },
  };

  const testnet: QieNetworkCatalogEntry = {
    key: 'qie-testnet',
    name: 'QIE Testnet',
    chainId: QIE_TESTNET_CHAIN_ID,
    chainIdHex: `0x${QIE_TESTNET_CHAIN_ID.toString(16)}`,
    symbol: 'QIE',
    nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
    rpcUrls: testnetRpcs,
    explorer: explorerTemplates(testnetExplorer),
    faucetUrl: cleanUrl(optionalEnv('QIE_TESTNET_FAUCET_URL')) ?? DEFAULT_LINKS.faucet,
    docsUrl: 'https://docs.qie.digital/getting-started-with-qie-blockchain/4.-get-testnet-coins-faucet',
    walletAddNetwork: {
      chainId: `0x${QIE_TESTNET_CHAIN_ID.toString(16)}`,
      chainName: 'QIE Testnet',
      nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
      rpcUrls: testnetRpcs.map((item) => item.url),
      blockExplorerUrls: [testnetExplorer],
    },
  };

  return {
    ok: true,
    source: 'qie_official_docs_and_backend_env',
    activeNetwork: 'qie-mainnet',
    networks: [mainnet, testnet],
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

function ecosystemLink(
  id: string,
  name: string,
  category: EcosystemLink['category'],
  envVar: string,
  fallbackUrl: string,
): EcosystemLink {
  const configured = cleanUrl(optionalEnv(envVar));
  const url = configured ?? fallbackUrl;
  return {
    id,
    name,
    category,
    url,
    availability: url ? 'available' : 'not_configured',
    reason: configured ? `${envVar} configured` : 'QIE ecosystem public URL',
  };
}

export function qieEcosystemLinks() {
  const links: EcosystemLink[] = [
    ecosystemLink('wallet', 'QIE Wallet', 'wallet', 'QIE_WALLET_URL', DEFAULT_LINKS.wallet),
    ecosystemLink('explorer', 'QIE Explorer', 'network', 'QIE_EXPLORER_URL', DEFAULT_LINKS.explorer),
    ecosystemLink('domains', 'QIE Domains', 'identity', 'QIE_DOMAINS_URL', DEFAULT_LINKS.domains),
    ecosystemLink('pass', 'QIE Pass', 'identity', 'QIE_PASS_URL', DEFAULT_LINKS.pass),
    ecosystemLink('dex', 'QIE DEX', 'defi', 'QIE_DEX_URL', DEFAULT_LINKS.dex),
    ecosystemLink('bridge', 'QIE Bridge', 'defi', 'QIE_BRIDGE_URL', DEFAULT_LINKS.bridge),
    ecosystemLink('faucet', 'QIE Testnet Faucet', 'network', 'QIE_TESTNET_FAUCET_URL', DEFAULT_LINKS.faucet),
    ecosystemLink('docs', 'QIE Docs', 'developer', 'QIE_DOCS_URL', DEFAULT_LINKS.docs),
    ecosystemLink('stable', 'QUSDC Stable', 'defi', 'QUSDC_STABLE_URL', DEFAULT_LINKS.stable),
    ecosystemLink('sdk', 'QIE Developer Docs', 'developer', 'QIE_SDK_URL', DEFAULT_LINKS.sdk),
  ];
  return {
    ok: true,
    source: 'qie_ecosystem_registry',
    links,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

function linkById(id: string): string | null {
  return qieEcosystemLinks().links.find((link) => link.id === id)?.url ?? null;
}

export function acquisitionRoutesForToken(tokenSymbol: 'QIE' | 'QUSDC'): AcquisitionRoute[] {
  const bridgeUrl = linkById('bridge');
  const dexUrl = linkById('dex');
  const walletUrl = linkById('wallet');
  const stableUrl = linkById('stable');
  const vaultAddress = optionalEnv('QUSDC_VAULT_ADDRESS') ?? null;
  const wusdcAddress = optionalEnv('WUSDC_ADDRESS') ?? null;
  const qusdcAddress = optionalEnv('QUSDC_ADDRESS') ?? null;
  const vaultMintMethod = optionalEnv('QUSDC_VAULT_MINT_METHOD') === 'deposit' ? 'deposit' : 'mint';
  const vaultReady = !!vaultAddress && ADDRESS_RE.test(vaultAddress) && !!wusdcAddress && ADDRESS_RE.test(wusdcAddress) && !!qusdcAddress && ADDRESS_RE.test(qusdcAddress);

  if (tokenSymbol === 'QIE') {
    return [
      {
        id: 'qie.wallet',
        label: 'Get QIE Wallet',
        tokenSymbol,
        state: walletUrl ? 'available' : 'disabled',
        reason: walletUrl ? 'Official QIE Wallet link' : 'QIE_WALLET_URL is not configured',
        actionType: 'external_link',
        url: walletUrl,
        requiresRealTx: true,
        source: 'qie_ecosystem_registry',
      },
      {
        id: 'qie.bridge',
        label: 'Bridge assets to QIE',
        tokenSymbol,
        state: bridgeUrl ? 'available' : 'disabled',
        reason: bridgeUrl ? 'Bridge opens the official QIE Bridge; Qantara does not fabricate bridge state' : 'QIE_BRIDGE_URL is not configured',
        actionType: 'external_link',
        url: bridgeUrl,
        requiresRealTx: true,
        source: 'qie_ecosystem_registry',
      },
    ];
  }

  return [
    {
      id: 'qusdc.mint_vault',
      label: 'Mint QUSDC from WUSDC',
      tokenSymbol,
      state: vaultReady ? 'available' : 'disabled',
      reason: vaultReady ? 'QUSDC vault and WUSDC contracts are configured' : 'QUSDC_VAULT_ADDRESS, WUSDC_ADDRESS, and QUSDC_ADDRESS are required',
      actionType: 'contract_mint',
      url: stableUrl,
      requiresRealTx: true,
      source: 'qusdc_vault_config',
      metadata: { vaultAddress, wusdcAddress, qusdcAddress, mintMethod: vaultMintMethod },
    },
    {
      id: 'qusdc.dex',
      label: 'Swap to QUSDC on QIE DEX',
      tokenSymbol,
      state: dexUrl ? 'available' : 'disabled',
      reason: dexUrl ? 'External DEX route; Qantara still waits for RPC payment verification' : 'QIE_DEX_URL is not configured',
      actionType: 'external_link',
      url: dexUrl,
      requiresRealTx: true,
      source: 'qie_ecosystem_registry',
    },
    {
      id: 'qusdc.bridge',
      label: 'Bridge stablecoins to QIE',
      tokenSymbol,
      state: bridgeUrl ? 'available' : 'disabled',
      reason: bridgeUrl ? 'External bridge route; Qantara does not fabricate bridge balances' : 'QIE_BRIDGE_URL is not configured',
      actionType: 'external_link',
      url: bridgeUrl,
      requiresRealTx: true,
      source: 'qie_ecosystem_registry',
    },
  ];
}

function lendingClient() {
  return createPublicClient({ transport: qieRpcTransport() });
}

async function readMarketValue<T>(
  address: Address,
  functionName: 'totalSupply' | 'totalBorrows' | 'balanceOfUnderlying' | 'borrowBalanceStored',
  args: readonly unknown[] = [],
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await lendingClient().readContract({
      address,
      abi: cTokenAbi,
      functionName,
      args,
    } as any);
    return { ok: true, value: value as T };
  } catch (err: any) {
    return { ok: false, error: err?.shortMessage || err?.message || `${functionName} unavailable` };
  }
}

export async function qieLendingStatus(address?: string) {
  const normalizedAddress = address && ADDRESS_RE.test(address) ? getAddress(address as Address) : null;
  const markets = await Promise.all(LENDING_MARKETS.map(async (market) => {
    const [totalSupply, totalBorrow] = await Promise.all([
      readMarketValue<bigint>(market.cToken, 'totalSupply'),
      readMarketValue<bigint>(market.cToken, 'totalBorrows'),
    ]);
    const portfolio = normalizedAddress ? await Promise.all([
      readMarketValue<bigint>(market.cToken, 'balanceOfUnderlying', [normalizedAddress]),
      readMarketValue<bigint>(market.cToken, 'borrowBalanceStored', [normalizedAddress]),
    ]) : null;

    return {
      ...market,
      source: 'qie_lend_sdk_contract_config',
      totals: {
        supply: totalSupply.ok ? totalSupply.value.toString() : null,
        borrow: totalBorrow.ok ? totalBorrow.value.toString() : null,
      },
      portfolio: portfolio ? {
        address: normalizedAddress,
        supplied: portfolio[0].ok ? portfolio[0].value.toString() : null,
        borrowed: portfolio[1].ok ? portfolio[1].value.toString() : null,
      } : null,
      status: totalSupply.ok || totalBorrow.ok ? 'available' : 'degraded',
      error: !totalSupply.ok && !totalBorrow.ok ? totalSupply.error : null,
    };
  }));

  return {
    ok: markets.some((market) => market.status === 'available'),
    source: 'qie_rpc_contract_reads',
    chainId: QIE_CHAIN_ID,
    comptroller: '0x69a31E3D361C69B37463aa67Ef93067dC760fBD4' as Address,
    address: normalizedAddress,
    markets,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

export function zeroAddress() {
  return ZERO_ADDRESS;
}
