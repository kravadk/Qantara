import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadE2eEnv } from './env-file.mjs';

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, '..');
const backendRoot = resolve(repoRoot, 'backend');
const e2e = loadE2eEnv(appRoot);

const env = {
  ...process.env,
  ...e2e,
  PORT: e2e.E2E_BACKEND_PORT || '4000',
  NODE_ENV: 'e2e',
  QANTARA_DB_PATH: e2e.E2E_DB_PATH || 'data/qantara-e2e.sqlite',
  QANTARA_FRONTEND_URL: e2e.E2E_FRONTEND_URL || 'http://127.0.0.1:5173',
  CORS_ORIGINS: e2e.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173',
  QIE_RPC_URL: e2e.E2E_QIE_RPC_URL || e2e.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital',
  QANTARA_ADDRESS: e2e.E2E_QANTARA_ADDRESS || e2e.QANTARA_ADDRESS || e2e.VITE_QANTARA_ADDRESS || '0x27815fC2021345EB38B68D9C8F08679A4aeee030',
  QUSDC_ADDRESS: e2e.E2E_QUSDC_ADDRESS || e2e.QUSDC_ADDRESS || e2e.VITE_QUSDC_ADDRESS || '',
  API_KEY: e2e.API_KEY || randomBytes(32).toString('hex'),
  WEBHOOK_SECRET: e2e.WEBHOOK_SECRET || randomBytes(32).toString('hex'),
  PAYMENT_INTENT_SECRET: e2e.PAYMENT_INTENT_SECRET || randomBytes(32).toString('hex'),
  SIWE_JWT_SECRET: e2e.SIWE_JWT_SECRET || randomBytes(32).toString('hex'),
};

const child = spawn('npm run dev', {
  cwd: backendRoot,
  env,
  stdio: 'inherit',
  shell: true,
});

function stop() {
  child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
