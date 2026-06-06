import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createPublicClient,
  defineChain,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
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

function env(name, fallback = '') {
  return process.env[name] || fileEnv[name] || fallback;
}

function requirePrivateKey(name, errors) {
  const value = env(name).trim();
  if (!value) {
    errors.push(`${name} is required`);
    return null;
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    errors.push(`${name} must be a 32-byte 0x private key`);
    return null;
  }
  return value;
}

function requirePositiveDecimal(name, fallback, errors) {
  const value = env(name, fallback).trim();
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
    errors.push(`${name} must be a positive decimal value`);
    return fallback;
  }
  return value;
}

const errors = [];
const merchantKey = requirePrivateKey('E2E_MERCHANT_PRIVATE_KEY', errors);
const payerKey = requirePrivateKey('E2E_PAYER_PRIVATE_KEY', errors);
const rpcUrl = env('E2E_QIE_RPC_URL', 'https://rpc1mainnet.qie.digital').trim();
const chainId = Number(env('E2E_CHAIN_ID', '1990'));
const chainName = env('E2E_CHAIN_NAME', chainId === 1983 ? 'QIE Testnet' : 'QIE Mainnet').trim();
const explorerUrl = env('E2E_EXPLORER_URL', chainId === 1983 ? 'https://testnet.qie.digital' : 'https://mainnet.qie.digital').replace(/\/$/, '');
const allowRealTx = env('E2E_ALLOW_REAL_TX') === 'true' || env('E2E_ALLOW_MAINNET_TX') === 'true';
const maxSpendQie = requirePositiveDecimal('E2E_MAX_SPEND_QIE', '0.05', errors);
const invoiceAmountQie = requirePositiveDecimal('E2E_INVOICE_AMOUNT_QIE', '0.001', errors);
const qusdcAddress = env('E2E_QUSDC_ADDRESS').trim();
const qusdcAmount = env('E2E_QUSDC_AMOUNT', '0.01').trim();

if (!rpcUrl) errors.push('E2E_QIE_RPC_URL is required');
if (!Number.isInteger(chainId) || chainId <= 0) errors.push('E2E_CHAIN_ID must be a positive integer');
if (!allowRealTx) errors.push('E2E_ALLOW_REAL_TX=true is required for the real on-chain lane');
if (parseEther(invoiceAmountQie) > parseEther(maxSpendQie)) {
  errors.push('E2E_INVOICE_AMOUNT_QIE must be less than or equal to E2E_MAX_SPEND_QIE');
}
if (qusdcAddress && !/^0x[a-fA-F0-9]{40}$/.test(qusdcAddress)) {
  errors.push('E2E_QUSDC_ADDRESS must be a valid 0x EVM address when configured');
}

const reportPath = resolve(appRoot, 'playwright-report', 'real-e2e-report.json');
function writeReport(status, skipReasons = [], extra = {}) {
  const wallet = (key) => {
    try {
      return key ? privateKeyToAccount(key).address : null;
    } catch {
      return null;
    }
  };
  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      frontendUrl: env('E2E_FRONTEND_URL', 'http://127.0.0.1:5173').replace(/\/$/, ''),
      backendUrl: env('E2E_BACKEND_URL', 'http://127.0.0.1:4000').replace(/\/$/, ''),
      rpcUrl,
      chainId,
      chainName,
      explorerUrl,
      allowRealTx,
      maxSpendWei: parseEther(maxSpendQie).toString(),
      invoiceAmount: invoiceAmountQie,
      qusdcConfigured: Boolean(qusdcAddress),
      webhookReceiverConfigured: Boolean(env('E2E_WEBHOOK_RECEIVER_URL')),
    },
    wallets: {
      merchant: wallet(merchantKey),
      payer: wallet(payerKey),
    },
    status,
    skipReasons,
    artifacts: { reportJson: reportPath },
    scenarios: [],
    ...extra,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (errors.length > 0) {
  writeReport('skipped', errors);
  console.error('E2E preflight failed before any transaction was sent:');
  for (const error of errors) console.error(`- ${error}`);
  console.error('');
  console.error('Create an ignored .env.e2e.local from .env.e2e.local.example, fund both wallets, then rerun npm run e2e:real.');
  process.exit(1);
}

const chain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'QIE Explorer', url: explorerUrl } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const merchant = privateKeyToAccount(merchantKey);
const payer = privateKeyToAccount(payerKey);

const [rpcChainId, blockNumber, merchantBalance, payerBalance] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getBlockNumber(),
  publicClient.getBalance({ address: merchant.address }),
  publicClient.getBalance({ address: payer.address }),
]);

if (rpcChainId !== chainId) {
  writeReport('skipped', [`RPC chain id ${rpcChainId} does not match E2E_CHAIN_ID=${chainId}`]);
  console.error(`E2E preflight failed: RPC chain id ${rpcChainId} does not match E2E_CHAIN_ID=${chainId}`);
  process.exit(1);
}

const requiredPayerBalance = parseEther(invoiceAmountQie);
if (payerBalance < requiredPayerBalance) {
  writeReport('skipped', [`payer ${payer.address} has ${formatEther(payerBalance)} QIE, needs at least ${invoiceAmountQie} QIE plus gas`]);
  console.error(`E2E preflight failed: payer ${payer.address} has ${formatEther(payerBalance)} QIE, needs at least ${invoiceAmountQie} QIE plus gas.`);
  process.exit(1);
}

if (merchantBalance === 0n) {
  writeReport('skipped', [`merchant ${merchant.address} has 0 QIE and cannot create on-chain invoices`]);
  console.error(`E2E preflight failed: merchant ${merchant.address} has 0 QIE and cannot create on-chain invoices.`);
  process.exit(1);
}

writeReport('created', [], {
  preflight: {
    rpcChainId,
    blockNumber: blockNumber.toString(),
    merchantBalanceQie: formatEther(merchantBalance),
    payerBalanceQie: formatEther(payerBalance),
  },
});

console.log('E2E preflight passed.');
console.log(`- RPC chain: ${rpcChainId}, block: ${blockNumber}`);
console.log(`- Merchant: ${merchant.address}, balance: ${formatEther(merchantBalance)} QIE`);
console.log(`- Payer: ${payer.address}, balance: ${formatEther(payerBalance)} QIE`);
console.log(`- Spend cap: ${maxSpendQie} QIE, invoice amount: ${invoiceAmountQie} QIE`);

if (qusdcAddress) {
  const [decimals, symbol, payerQusdc] = await Promise.all([
    publicClient.readContract({ address: qusdcAddress, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: qusdcAddress, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({ address: qusdcAddress, abi: erc20Abi, functionName: 'balanceOf', args: [payer.address] }),
  ]);
  console.log(`- QUSDC: ${symbol} ${qusdcAddress}, payer balance: ${formatUnits(payerQusdc, decimals)}`);
  if (Number(qusdcAmount) > 0 && payerQusdc < parseUnits(qusdcAmount, decimals)) {
    console.warn(`- QUSDC warning: payer balance is below E2E_QUSDC_AMOUNT=${qusdcAmount}. Native QIE lane can still run.`);
  }
} else {
console.log('- QUSDC: not configured for this preflight.');
}
