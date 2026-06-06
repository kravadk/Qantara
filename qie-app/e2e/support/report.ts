import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { e2eEnv, hasFundedWalletEnv } from './env';

type RealE2EReport = {
  generatedAt: string;
  environment: {
    frontendUrl: string;
    backendUrl: string;
    rpcUrl: string;
    chainId: number;
    allowRealTx: boolean;
    maxSpendWei: string;
    invoiceAmount: string;
    qusdcConfigured: boolean;
    webhookReceiverConfigured: boolean;
  };
  wallets: {
    merchant: string | null;
    payer: string | null;
  };
  status: 'created' | 'running' | 'passed' | 'failed' | 'skipped';
  skipReasons: string[];
  artifacts: {
    invoiceHash?: string;
    paymentTxHash?: string;
    receiptHash?: string;
    receiptTxHash?: string;
    reportJson?: string;
  };
  scenarios: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; detail?: string; at: string }>;
};

const reportPath = resolve(process.cwd(), 'playwright-report', 'real-e2e-report.json');

function walletAddress(privateKey: typeof e2eEnv.merchantPrivateKey): string | null {
  return privateKey ? privateKeyToAccount(privateKey).address : null;
}

function baseReport(): RealE2EReport {
  const skipReasons: string[] = [];
  if (!hasFundedWalletEnv()) skipReasons.push('E2E_MERCHANT_PRIVATE_KEY and E2E_PAYER_PRIVATE_KEY are required');
  if (!e2eEnv.allowRealTx) skipReasons.push('E2E_ALLOW_REAL_TX=true is required');
  return {
    generatedAt: new Date().toISOString(),
    environment: {
      frontendUrl: e2eEnv.frontendUrl,
      backendUrl: e2eEnv.backendUrl,
      rpcUrl: e2eEnv.rpcUrl,
      chainId: e2eEnv.chainId,
      allowRealTx: e2eEnv.allowRealTx,
      maxSpendWei: e2eEnv.maxSpendWei.toString(),
      invoiceAmount: e2eEnv.invoiceAmount,
      qusdcConfigured: Boolean(e2eEnv.qusdcAddress),
      webhookReceiverConfigured: Boolean(e2eEnv.webhookReceiverUrl),
    },
    wallets: {
      merchant: walletAddress(e2eEnv.merchantPrivateKey),
      payer: walletAddress(e2eEnv.payerPrivateKey),
    },
    status: skipReasons.length > 0 ? 'skipped' : 'created',
    skipReasons,
    artifacts: { reportJson: reportPath },
    scenarios: [],
  };
}

function readReport(): RealE2EReport {
  if (!existsSync(reportPath)) return baseReport();
  try {
    return { ...baseReport(), ...JSON.parse(readFileSync(reportPath, 'utf8')) };
  } catch {
    return baseReport();
  }
}

export function writeRealE2EReport(update: Partial<RealE2EReport>) {
  const current = readReport();
  const next: RealE2EReport = {
    ...current,
    ...update,
    generatedAt: new Date().toISOString(),
    environment: { ...current.environment, ...update.environment },
    wallets: { ...current.wallets, ...update.wallets },
    artifacts: { ...current.artifacts, ...update.artifacts },
    scenarios: update.scenarios ?? current.scenarios,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function appendRealE2EScenario(scenario: RealE2EReport['scenarios'][number]) {
  const current = readReport();
  return writeRealE2EReport({ scenarios: [...current.scenarios, scenario] });
}

export function initializeRealE2EReport() {
  return writeRealE2EReport(baseReport());
}
