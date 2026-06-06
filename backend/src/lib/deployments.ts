import { optionalEnv } from './env.js';

export type DeploymentHealth = 'configured' | 'address_mismatch' | 'not_configured';

export interface ContractDeployment {
  key: string;
  label: string;
  version: string;
  role: 'core' | 'token' | 'module';
  required: boolean;
  address: string;
  envVar: string;
  configuredAddress: string | null;
  status: DeploymentHealth;
  verified: boolean;
  deployedAt: string;
  verifiedAt?: string;
}

export interface DeploymentRegistryStatus {
  ok: boolean;
  network: 'qieMainnet';
  chainId: 1990;
  release: string;
  verifiedAt: string;
  requiredConfigured: boolean;
  contracts: ContractDeployment[];
}

const VERIFIED_AT = '2026-05-27T16:56:55.879Z';

const REGISTRY = [
  {
    key: 'Qantara',
    label: 'Qantara core',
    version: 'v1',
    role: 'core',
    required: true,
    address: '0x27815fC2021345EB38B68D9C8F08679A4aeee030',
    envVar: 'QANTARA_ADDRESS',
    deployedAt: '2026-05-27T16:49:51.278Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'QantaraMultiPay',
    label: 'Multi-pay invoices',
    version: 'v1',
    role: 'module',
    required: false,
    address: '0x72a5B88063E5783954c64244b75f9F8fDb3751Bb',
    envVar: 'QANTARA_MULTIPAY_ADDRESS',
    deployedAt: '2026-05-27T16:49:51.278Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'QUSDC',
    label: 'QUSDC token',
    version: 'v1',
    role: 'token',
    required: false,
    address: '0x88aBC76fd8e3d725139Ecc6BB75582aA3f14ec2D',
    envVar: 'QUSDC_ADDRESS',
    deployedAt: '2026-05-27T16:49:51.278Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'MilestoneEscrow',
    label: 'Milestone escrow',
    version: 'v1.5',
    role: 'module',
    required: false,
    address: '0x1D096D48d7bb2E6eF2FAfD1eC13C867b5461BA98',
    envVar: 'MILESTONE_ESCROW_ADDRESS',
    deployedAt: '2026-05-27T16:50:16.848Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'RecurringScheduler',
    label: 'Recurring scheduler',
    version: 'v1.5',
    role: 'module',
    required: false,
    address: '0xb05D67901A43644fD831EEC4e6554970e791F690',
    envVar: 'RECURRING_SCHEDULER_ADDRESS',
    deployedAt: '2026-05-27T16:50:16.848Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'BatchPayout',
    label: 'Batch payouts',
    version: 'v1.5',
    role: 'module',
    required: false,
    address: '0x49EC10ACd67716e35E5129c9ae83C62456502a83',
    envVar: 'BATCH_PAYOUT_ADDRESS',
    deployedAt: '2026-05-27T16:50:16.848Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'QantaraChat',
    label: 'On-chain chat anchor',
    version: 'v4',
    role: 'module',
    required: false,
    address: '0x76E618ecca8D97038Ec11641E16b9e16a378576A',
    envVar: 'QANTARA_CHAT_ADDRESS',
    deployedAt: '2026-05-28T18:42:45.575Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'QantaraSplits',
    label: 'Split payments',
    version: 'v4',
    role: 'module',
    required: false,
    address: '0xBbaeF9CF47C31436505E46cF2a39636a76C7C413',
    envVar: 'QANTARA_SPLITS_ADDRESS',
    deployedAt: '2026-05-28T18:42:45.575Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'QantaraSubscriptionV2',
    label: 'Subscriptions',
    version: 'v4',
    role: 'module',
    required: false,
    address: '0x30ACe939BD62b6a9E9aF3f5AB4287b5FB5F39c06',
    envVar: 'QANTARA_SUBSCRIPTION_V2_ADDRESS',
    deployedAt: '2026-05-28T18:42:45.575Z',
    verifiedAt: VERIFIED_AT,
  },
  {
    key: 'QantaraGasRelay',
    label: 'Gas relay',
    version: 'v4',
    role: 'module',
    required: false,
    address: '0xE027abFb3F845c6798fA247f1053Bd1B143768d2',
    envVar: 'QANTARA_GAS_RELAY_ADDRESS',
    deployedAt: '2026-05-28T18:42:45.575Z',
    verifiedAt: VERIFIED_AT,
  },
] satisfies Array<Omit<ContractDeployment, 'configuredAddress' | 'status' | 'verified'>>;

function addressStatus(expected: string, configuredAddress: string | undefined): DeploymentHealth {
  if (!configuredAddress) return 'not_configured';
  return configuredAddress.toLowerCase() === expected.toLowerCase() ? 'configured' : 'address_mismatch';
}

export function deploymentRegistryStatus(): DeploymentRegistryStatus {
  const contracts = REGISTRY.map((entry): ContractDeployment => {
    const configuredAddress = optionalEnv(entry.envVar) ?? null;
    return {
      ...entry,
      configuredAddress,
      status: addressStatus(entry.address, configuredAddress ?? undefined),
      verified: !!entry.verifiedAt,
    };
  });
  const requiredConfigured = contracts.every((contract) => !contract.required || contract.status === 'configured');
  return {
    ok: requiredConfigured,
    network: 'qieMainnet',
    chainId: 1990,
    release: '0.1.0',
    verifiedAt: VERIFIED_AT,
    requiredConfigured,
    contracts,
  };
}
