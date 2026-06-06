import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEther, type Hex } from 'viem';

type EnvMap = Record<string, string>;

function parseEnvFile(path: string): EnvMap {
  if (!existsSync(path)) return {};
  const out: EnvMap = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const appRoot = resolve(process.cwd());
const repoRoot = resolve(appRoot, '..');
const fileEnv = {
  ...parseEnvFile(resolve(repoRoot, '.env.e2e.local')),
  ...parseEnvFile(resolve(appRoot, '.env.e2e.local')),
};

function env(name: string, fallback = '') {
  return process.env[name] || fileEnv[name] || fallback;
}

function privateKey(name: string): Hex | undefined {
  const value = env(name).trim();
  if (!value) return undefined;
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte 0x private key`);
  }
  return value as Hex;
}

export const e2eEnv = {
  frontendUrl: env('E2E_FRONTEND_URL', 'http://127.0.0.1:5173').replace(/\/$/, ''),
  backendUrl: env('E2E_BACKEND_URL', 'http://127.0.0.1:4000').replace(/\/$/, ''),
  rpcUrl: env('E2E_QIE_RPC_URL', 'https://rpc1mainnet.qie.digital'),
  chainId: Number(env('E2E_CHAIN_ID', '1990')),
  chainName: env('E2E_CHAIN_NAME', 'QIE Mainnet'),
  explorerUrl: env('E2E_EXPLORER_URL', 'https://mainnet.qie.digital').replace(/\/$/, ''),
  merchantPrivateKey: privateKey('E2E_MERCHANT_PRIVATE_KEY'),
  payerPrivateKey: privateKey('E2E_PAYER_PRIVATE_KEY'),
  allowRealTx: env('E2E_ALLOW_REAL_TX') === 'true' || env('E2E_ALLOW_MAINNET_TX') === 'true',
  maxSpendWei: parseEther(env('E2E_MAX_SPEND_QIE', '0.05')),
  invoiceAmount: env('E2E_INVOICE_AMOUNT_QIE', '0.001'),
  qusdcAddress: env('E2E_QUSDC_ADDRESS'),
  qusdcAmount: env('E2E_QUSDC_AMOUNT', '0.01'),
  webhookReceiverUrl: env('E2E_WEBHOOK_RECEIVER_URL'),
};

export function hasFundedWalletEnv() {
  return Boolean(e2eEnv.merchantPrivateKey && e2eEnv.payerPrivateKey);
}

export function canRunRealTx() {
  return hasFundedWalletEnv() && e2eEnv.allowRealTx;
}

export const canRunMainnetTx = canRunRealTx;
