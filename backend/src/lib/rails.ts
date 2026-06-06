import { optionalEnv } from './env.js';
import { deploymentRegistryStatus, type ContractDeployment } from './deployments.js';
import { rpcStatus } from './chain.js';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { acquisitionRoutesForToken, qieEcosystemLinks, qieNetworkCatalog } from './qieEcosystem.js';

const QIE_CHAIN_ID = 1990;
const DEFAULT_QIE_RPC_LABEL = 'default-qie-mainnet';
const DEFAULT_QIE_EXPLORER_URL = 'https://mainnet.qie.digital';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_ADDRESS_TYPED = ZERO_ADDRESS as Address;
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const capabilityAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function nonces(address owner) view returns (uint256)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
]);

export type RailAvailability = 'enabled' | 'disabled';

export interface RailFlow {
  key: string;
  label: string;
  rail: 'QIE' | 'QUSDC';
  enabled: boolean;
  reason: string;
}

export type QusdcCapabilityProbe = {
  supported: boolean;
  status: 'ready' | 'disabled' | 'degraded';
  reason: string;
  address: string | null;
  metadata: { name: string | null; symbol: string | null; decimals: number | null };
  capabilities: {
    erc20Transfer: boolean;
    approveAndPay: boolean;
    permit: { supported: boolean; reason: string };
    eip3009: { supported: boolean; reason: string };
  };
  checkedAt: number;
  source: 'qie_rpc_contract_probe';
};

let cachedQusdcProbe: { expiresAt: number; value: QusdcCapabilityProbe } | null = null;

function isAddress(value: string | null | undefined): value is `0x${string}` {
  return !!value && ADDRESS_RE.test(value);
}

function rpcClient() {
  return createPublicClient({
    transport: http(optionalEnv('QIE_RPC_URL') ?? 'https://rpc1mainnet.qie.digital'),
  });
}

async function readOptional<T>(
  address: Address,
  functionName: 'name' | 'symbol' | 'decimals' | 'DOMAIN_SEPARATOR' | 'nonces' | 'authorizationState',
  args: readonly unknown[] = [],
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    const value = await rpcClient().readContract({
      address,
      abi: capabilityAbi,
      functionName,
      args,
    } as any);
    return { ok: true, value: value as T };
  } catch (err: any) {
    return { ok: false, reason: err?.shortMessage || err?.message || `${functionName} unavailable` };
  }
}

function configuredContract(entry: ContractDeployment) {
  return {
    key: entry.key,
    label: entry.label,
    role: entry.role,
    version: entry.version,
    envVar: entry.envVar,
    address: entry.configuredAddress,
    expectedAddress: entry.address,
    status: entry.status,
    verified: entry.verified,
    required: entry.required,
  };
}

function qusdcStatus(qusdc: ContractDeployment | undefined): {
  enabled: boolean;
  status: RailAvailability;
  reason: string;
  address: string | null;
} {
  const configuredAddress = qusdc?.configuredAddress ?? optionalEnv('QUSDC_ADDRESS') ?? null;
  if (!configuredAddress) {
    return {
      enabled: false,
      status: 'disabled',
      reason: 'QUSDC_ADDRESS is not configured',
      address: null,
    };
  }
  if (!isAddress(configuredAddress)) {
    return {
      enabled: false,
      status: 'disabled',
      reason: 'QUSDC_ADDRESS is not a valid EVM address',
      address: configuredAddress,
    };
  }
  if (qusdc && qusdc.status === 'address_mismatch') {
    return {
      enabled: false,
      status: 'disabled',
      reason: 'QUSDC_ADDRESS does not match the verified deployment registry',
      address: configuredAddress,
    };
  }
  return {
    enabled: true,
    status: 'enabled',
    reason: qusdc ? 'QUSDC_ADDRESS is configured and matches the verified deployment registry' : 'QUSDC_ADDRESS is configured',
    address: configuredAddress,
  };
}

export async function qusdcCapabilities(): Promise<QusdcCapabilityProbe> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedQusdcProbe && cachedQusdcProbe.expiresAt > now) return cachedQusdcProbe.value;

  const registry = deploymentRegistryStatus();
  const qusdc = registry.contracts.find((contract) => contract.key === 'QUSDC');
  const configured = qusdcStatus(qusdc);
  if (!configured.enabled || !configured.address || !isAddress(configured.address)) {
    const value: QusdcCapabilityProbe = {
      supported: false,
      status: 'disabled',
      reason: configured.reason,
      address: configured.address,
      metadata: { name: null, symbol: null, decimals: null },
      capabilities: {
        erc20Transfer: false,
        approveAndPay: false,
        permit: { supported: false, reason: configured.reason },
        eip3009: { supported: false, reason: configured.reason },
      },
      checkedAt: now,
      source: 'qie_rpc_contract_probe',
    };
    cachedQusdcProbe = { expiresAt: now + 60, value };
    return value;
  }

  const address = configured.address as Address;
  const [name, symbol, decimals, domain, nonce, authState] = await Promise.all([
    readOptional<string>(address, 'name'),
    readOptional<string>(address, 'symbol'),
    readOptional<number>(address, 'decimals'),
    readOptional<Hex>(address, 'DOMAIN_SEPARATOR'),
    readOptional<bigint>(address, 'nonces', [ZERO_ADDRESS_TYPED]),
    readOptional<boolean>(address, 'authorizationState', [ZERO_ADDRESS_TYPED, ZERO_BYTES32]),
  ]);
  const permitSupported = domain.ok && nonce.ok;
  const eip3009Supported = authState.ok;
  const permitReason = permitSupported
    ? 'DOMAIN_SEPARATOR and nonces are callable'
    : [domain, nonce].filter((item) => !item.ok).map((item) => (item as { ok: false; reason: string }).reason).join(' / ');

  const value: QusdcCapabilityProbe = {
    supported: true,
    status: permitSupported || eip3009Supported ? 'ready' : 'degraded',
    reason: configured.reason,
    address,
    metadata: {
      name: name.ok ? name.value : null,
      symbol: symbol.ok ? symbol.value : null,
      decimals: decimals.ok ? Number(decimals.value) : null,
    },
    capabilities: {
      erc20Transfer: true,
      approveAndPay: true,
      permit: { supported: permitSupported, reason: permitReason || 'Permit methods are unavailable' },
      eip3009: { supported: eip3009Supported, reason: eip3009Supported ? 'authorizationState is callable' : authState.reason },
    },
    checkedAt: now,
    source: 'qie_rpc_contract_probe',
  };
  cachedQusdcProbe = { expiresAt: now + 60, value };
  return value;
}

function qantaraEnabled(qantara: ContractDeployment | undefined): { enabled: boolean; reason: string; address: string | null } {
  const configuredAddress = qantara?.configuredAddress ?? optionalEnv('QANTARA_ADDRESS') ?? null;
  if (!configuredAddress) return { enabled: false, reason: 'QANTARA_ADDRESS is not configured', address: null };
  if (!isAddress(configuredAddress)) return { enabled: false, reason: 'QANTARA_ADDRESS is not a valid EVM address', address: configuredAddress };
  if (qantara && qantara.status === 'address_mismatch') {
    return { enabled: false, reason: 'QANTARA_ADDRESS does not match the verified deployment registry', address: configuredAddress };
  }
  return { enabled: true, reason: 'QANTARA_ADDRESS is configured', address: configuredAddress };
}

function moduleEnabled(entry: ContractDeployment | undefined, envVar: string): { enabled: boolean; reason: string } {
  const configuredAddress = entry?.configuredAddress ?? optionalEnv(envVar) ?? null;
  if (!configuredAddress) return { enabled: false, reason: `${envVar} is not configured` };
  if (!isAddress(configuredAddress)) return { enabled: false, reason: `${envVar} is not a valid EVM address` };
  if (entry && entry.status === 'address_mismatch') return { enabled: false, reason: `${envVar} does not match the verified deployment registry` };
  return { enabled: true, reason: `${envVar} is configured` };
}

function gaslessPaymasterStatus(): { enabled: boolean; reason: string; provider: string; checkoutUrl: string | null } {
  const provider = optionalEnv('QUSDC_PAYMASTER_PROVIDER') ?? 'qie_paymaster';
  const checkoutUrl = optionalEnv('QUSDC_PAYMASTER_CHECKOUT_URL') ?? null;
  if (!checkoutUrl) {
    return {
      enabled: false,
      reason: 'QUSDC_PAYMASTER_CHECKOUT_URL is not configured',
      provider,
      checkoutUrl: null,
    };
  }
  try {
    const parsed = new URL(checkoutUrl);
    if (parsed.protocol !== 'https:') {
      return {
        enabled: false,
        reason: 'QUSDC_PAYMASTER_CHECKOUT_URL must use https',
        provider,
        checkoutUrl,
      };
    }
    return {
      enabled: true,
      reason: `${provider} gasless checkout is configured`,
      provider,
      checkoutUrl,
    };
  } catch {
    return {
      enabled: false,
      reason: 'QUSDC_PAYMASTER_CHECKOUT_URL is not a valid URL',
      provider,
      checkoutUrl,
    };
  }
}

function explorerBaseUrl(): string {
  const configured = optionalEnv('QIE_EXPLORER_URL') ?? optionalEnv('QIE_EXPLORER_API_URL') ?? DEFAULT_QIE_EXPLORER_URL;
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_QIE_EXPLORER_URL;
  }
}

function explorerLinks(address: string | null) {
  const baseUrl = explorerBaseUrl();
  return {
    addressUrl: address ? `${baseUrl}/address/${address}` : null,
    txUrlTemplate: `${baseUrl}/tx/{txHash}`,
    addressUrlTemplate: `${baseUrl}/address/{address}`,
  };
}

async function explorerStatus() {
  const configured = optionalEnv('QIE_EXPLORER_URL') ?? optionalEnv('QIE_EXPLORER_API_URL');
  if (!configured) {
    return {
      configured: false,
      ok: null,
      baseUrl: null,
      reason: 'QIE_EXPLORER_URL is not configured',
    };
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return {
      configured: true,
      ok: false,
      baseUrl: null,
      reason: 'Configured explorer URL is invalid',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url.origin, { method: 'HEAD', signal: controller.signal });
    return {
      configured: true,
      ok: response.ok,
      baseUrl: url.origin,
      status: response.status,
    };
  } catch (err: any) {
    return {
      configured: true,
      ok: false,
      baseUrl: url.origin,
      reason: err?.name === 'AbortError' ? 'Explorer health check timed out' : (err?.message ?? 'Explorer unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function railCatalog() {
  const registry = deploymentRegistryStatus();
  const contractsByKey = new Map(registry.contracts.map((contract) => [contract.key, contract]));
  const qantara = contractsByKey.get('Qantara');
  const qusdc = contractsByKey.get('QUSDC');
  const qantaraStatus = qantaraEnabled(qantara);
  const qusdcRail = qusdcStatus(qusdc);
  const explorer = {
    baseUrl: explorerBaseUrl(),
    txUrlTemplate: `${explorerBaseUrl()}/tx/{txHash}`,
    addressUrlTemplate: `${explorerBaseUrl()}/address/{address}`,
  };
  const supportedWallets = [
    {
      id: 'qie-wallet',
      name: 'QIE Wallet',
      type: 'browser-extension',
      connection: 'injected',
      status: 'supported',
      reason: 'Primary QIE ecosystem wallet for browser checkout',
    },
    {
      id: 'walletconnect',
      name: 'WalletConnect',
      type: 'walletconnect',
      connection: 'walletconnect',
      status: 'supported',
      reason: 'Supported through the frontend wallet connector stack',
    },
    {
      id: 'injected-eip1193',
      name: 'Injected EIP-1193 wallet',
      type: 'browser-extension',
      connection: 'injected',
      status: 'supported',
      reason: 'Compatible wallets expose the standard EIP-1193 provider',
    },
  ];
  const multiPay = moduleEnabled(contractsByKey.get('QantaraMultiPay'), 'QANTARA_MULTIPAY_ADDRESS');
  const escrow = moduleEnabled(contractsByKey.get('MilestoneEscrow'), 'MILESTONE_ESCROW_ADDRESS');
  const recurring = moduleEnabled(contractsByKey.get('RecurringScheduler'), 'RECURRING_SCHEDULER_ADDRESS');
  const batch = moduleEnabled(contractsByKey.get('BatchPayout'), 'BATCH_PAYOUT_ADDRESS');
  const splits = moduleEnabled(contractsByKey.get('QantaraSplits'), 'QANTARA_SPLITS_ADDRESS');
  const subscription = moduleEnabled(contractsByKey.get('QantaraSubscriptionV2'), 'QANTARA_SUBSCRIPTION_V2_ADDRESS');
  const gasRelay = moduleEnabled(contractsByKey.get('QantaraGasRelay'), 'QANTARA_GAS_RELAY_ADDRESS');
  const paymaster = gaslessPaymasterStatus();
  const eip3009 = optionalEnv('QANTARA_SUPPORTS_EIP3009') === 'true';

  const flows: RailFlow[] = [
    {
      key: 'qie.direct_transfer',
      label: 'Native QIE direct transfer',
      rail: 'QIE',
      enabled: true,
      reason: 'Native QIE is the QIE chain gas token',
    },
    {
      key: 'qie.qantara_invoice',
      label: 'Native QIE Qantara invoice payment',
      rail: 'QIE',
      enabled: qantaraStatus.enabled,
      reason: qantaraStatus.reason,
    },
    {
      key: 'qusdc.gasless_paymaster',
      label: 'Gasless QUSDC paymaster checkout',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && paymaster.enabled,
      reason: qusdcRail.enabled ? paymaster.reason : qusdcRail.reason,
    },
    {
      key: 'qusdc.direct_transfer',
      label: 'QUSDC ERC-20 direct transfer',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled,
      reason: qusdcRail.reason,
    },
    {
      key: 'qusdc.approve_and_pay',
      label: 'QUSDC approve plus Qantara invoice payment',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && qantaraStatus.enabled,
      reason: qusdcRail.enabled ? qantaraStatus.reason : qusdcRail.reason,
    },
    {
      key: 'qusdc.permit_and_pay',
      label: 'QUSDC permit plus Qantara invoice payment',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && qantaraStatus.enabled,
      reason: qusdcRail.enabled ? qantaraStatus.reason : qusdcRail.reason,
    },
    {
      key: 'qusdc.transfer_with_authorization',
      label: 'QUSDC EIP-3009 transfer authorization',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && qantaraStatus.enabled && eip3009,
      reason: eip3009 ? (qusdcRail.enabled ? qantaraStatus.reason : qusdcRail.reason) : 'QANTARA_SUPPORTS_EIP3009 is not enabled',
    },
    {
      key: 'module.multipay',
      label: 'Multi-pay invoices',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && multiPay.enabled,
      reason: qusdcRail.enabled ? multiPay.reason : qusdcRail.reason,
    },
    {
      key: 'module.escrow',
      label: 'Milestone escrow',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && escrow.enabled,
      reason: qusdcRail.enabled ? escrow.reason : qusdcRail.reason,
    },
    {
      key: 'module.recurring',
      label: 'Recurring payments',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && recurring.enabled,
      reason: qusdcRail.enabled ? recurring.reason : qusdcRail.reason,
    },
    {
      key: 'module.batch_payout',
      label: 'Batch payouts',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && batch.enabled,
      reason: qusdcRail.enabled ? batch.reason : qusdcRail.reason,
    },
    {
      key: 'module.splits',
      label: 'Split payments',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && splits.enabled,
      reason: qusdcRail.enabled ? splits.reason : qusdcRail.reason,
    },
    {
      key: 'module.subscriptions',
      label: 'Subscriptions',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && subscription.enabled,
      reason: qusdcRail.enabled ? subscription.reason : qusdcRail.reason,
    },
    {
      key: 'module.gas_relay',
      label: 'Gas relay sponsored checkout',
      rail: 'QUSDC',
      enabled: qusdcRail.enabled && gasRelay.enabled,
      reason: qusdcRail.enabled ? gasRelay.reason : qusdcRail.reason,
    },
  ];

  const qieRail = {
    id: `${QIE_CHAIN_ID}:QIE`,
    key: 'qie.native',
    name: 'Native QIE',
    kind: 'invoice',
    network: 'qieMainnet',
    chainId: QIE_CHAIN_ID,
    token: 'QIE',
    tokenSymbol: 'QIE',
    tokenAddress: ZERO_ADDRESS,
    contractAddress: qantaraStatus.address,
    enabled: true,
    status: 'enabled' as RailAvailability,
    reason: 'Native QIE is the QIE chain gas token',
    explorer: {
      ...explorerLinks(qantaraStatus.address),
      tokenUrl: null,
      settlementContractUrl: qantaraStatus.address ? `${explorer.baseUrl}/address/${qantaraStatus.address}` : null,
    },
    flows: flows
      .filter((flow) => flow.rail === 'QIE')
      .map((flow) => ({ id: flow.key, key: flow.key, label: flow.label, enabled: flow.enabled, status: flow.enabled ? 'enabled' : 'disabled', reason: flow.reason })),
    acquisitionRoutes: acquisitionRoutesForToken('QIE'),
    externalActions: acquisitionRoutesForToken('QIE').filter((route) => route.actionType === 'external_link'),
    requiresRealTx: true,
  };

  const qusdcRailRecord = {
    id: `${QIE_CHAIN_ID}:QUSDC`,
    key: 'qusdc.erc20',
    name: 'QUSDC',
    kind: 'invoice',
    network: 'qieMainnet',
    chainId: QIE_CHAIN_ID,
    token: 'QUSDC',
    tokenSymbol: 'QUSDC',
    tokenAddress: qusdcRail.address,
    contractAddress: qantaraStatus.address,
    enabled: qusdcRail.enabled,
    status: qusdcRail.status,
    reason: qusdcRail.reason,
    decimals: 6,
    explorer: {
      ...explorerLinks(qusdcRail.address),
      tokenUrl: qusdcRail.address ? `${explorer.baseUrl}/address/${qusdcRail.address}` : null,
      settlementContractUrl: qantaraStatus.address ? `${explorer.baseUrl}/address/${qantaraStatus.address}` : null,
    },
    flows: flows
      .filter((flow) => flow.rail === 'QUSDC')
      .map((flow) => ({ id: flow.key, key: flow.key, label: flow.label, enabled: flow.enabled, status: flow.enabled ? 'enabled' : 'disabled', reason: flow.reason })),
    acquisitionRoutes: acquisitionRoutesForToken('QUSDC'),
    externalActions: acquisitionRoutesForToken('QUSDC').filter((route) => route.actionType === 'external_link'),
    requiresRealTx: true,
  };

  return {
    ok: true,
    network: {
      key: 'qieMainnet',
      name: 'QIE Mainnet',
      chainId: QIE_CHAIN_ID,
      nativeCurrency: {
        symbol: 'QIE',
        decimals: 18,
      },
      explorer,
    },
    networkCatalog: qieNetworkCatalog(),
    ecosystem: qieEcosystemLinks(),
    health: {
      rpc: await rpcStatus(),
      explorer: await explorerStatus(),
    },
    rpc: {
      configured: !!optionalEnv('QIE_RPC_URL'),
      label: optionalEnv('QIE_RPC_URL') ? 'custom' : DEFAULT_QIE_RPC_LABEL,
    },
    contracts: registry.contracts.map(configuredContract),
    wallets: supportedWallets,
    rails: [qieRail, qusdcRailRecord],
    acquisitionRoutes: [
      ...qieRail.acquisitionRoutes,
      ...qusdcRailRecord.acquisitionRoutes,
    ],
    externalActions: [
      ...qieRail.externalActions,
      ...qusdcRailRecord.externalActions,
    ],
    requiresRealTx: true,
    tokens: {
      qie: {
        enabled: true,
        status: 'enabled' as RailAvailability,
        tokenAddress: ZERO_ADDRESS,
        reason: 'Native QIE is the QIE chain gas token',
      },
      qusdc: {
        ...qusdcRail,
        decimals: 6,
      },
    },
    paymaster: {
      qusdc: paymaster,
    },
    supportedFlows: flows,
    count: 2,
    deploymentRegistry: {
      ok: registry.ok,
      release: registry.release,
      verifiedAt: registry.verifiedAt,
      requiredConfigured: registry.requiredConfigured,
    },
  };
}
