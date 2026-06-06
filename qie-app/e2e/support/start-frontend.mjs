import { spawn } from 'node:child_process';
import { loadE2eEnv } from './env-file.mjs';

const e2e = loadE2eEnv(process.cwd());
const env = {
  ...process.env,
  ...e2e,
  VITE_QANTARA_BACKEND_URL: e2e.E2E_BACKEND_URL || e2e.VITE_QANTARA_BACKEND_URL || 'http://127.0.0.1:4000',
  VITE_QANTARA_ADDRESS: e2e.E2E_QANTARA_ADDRESS || e2e.VITE_QANTARA_ADDRESS || '0x27815fC2021345EB38B68D9C8F08679A4aeee030',
  VITE_QANTARA_MULTIPAY_ADDRESS: e2e.E2E_QANTARA_MULTIPAY_ADDRESS || e2e.VITE_QANTARA_MULTIPAY_ADDRESS || '0x72a5B88063E5783954c64244b75f9F8fDb3751Bb',
  VITE_QUSDC_ADDRESS: e2e.E2E_QUSDC_ADDRESS || e2e.VITE_QUSDC_ADDRESS || '',
  VITE_QANTARA_SUPPORTS_EIP3009: e2e.E2E_QANTARA_SUPPORTS_EIP3009 || e2e.VITE_QANTARA_SUPPORTS_EIP3009 || 'false',
};

const child = spawn('npm run dev -- --host 127.0.0.1', {
  cwd: process.cwd(),
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
