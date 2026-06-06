#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const envFile = process.argv[2] || process.env.QANTARA_ENV_FILE || '.env.production';
const expectedChainId = BigInt(process.env.EXPECTED_CHAIN_ID || '1990');
const rpcTimeoutMs = Number(process.env.PREFLIGHT_RPC_TIMEOUT_MS || '10000');
const failures = [];
const warnings = [];

function parseEnv(path) {
  if (!existsSync(path)) {
    failures.push(`env file not found: ${path}`);
    return {};
  }
  const out = {};
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
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

const env = { ...parseEnv(envFile), ...process.env };

function value(name) {
  return env[name]?.trim();
}

function requireValue(name, { secret = false, address = false, url = false, publicUrl = false } = {}) {
  const current = value(name);
  if (!current) {
    failures.push(`${name} is required`);
    return undefined;
  }
  if (secret && current.length < 24) failures.push(`${name} is too short for production use`);
  if (secret && /^(change[-_]?me|password|secret|123456|test[-_]?key|dev[-_]?key)$/i.test(current)) {
    failures.push(`${name} uses a placeholder value`);
  }
  if (address && !/^0x[a-fA-F0-9]{40}$/.test(current)) failures.push(`${name} must be a 20-byte 0x address`);
  if (url) {
    try {
      const parsed = new URL(current);
      if (!['http:', 'https:'].includes(parsed.protocol)) failures.push(`${name} must be http(s)`);
      if (publicUrl && parsed.protocol !== 'https:') {
        const host = parsed.hostname.toLowerCase();
        const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        if (!loopback) failures.push(`${name} must use https for production traffic`);
      }
    } catch {
      failures.push(`${name} must be a valid URL`);
    }
  }
  return current;
}

async function rpc(method, params = []) {
  const rpcUrl = value('QIE_RPC_URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), rpcTimeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message || body.error.code}`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function decodeAbiStringOrBytes32(raw) {
  if (!raw || raw === '0x') return '';
  try {
    const hex = raw.slice(2);
    if (hex.length === 64) {
      return Buffer.from(hex.replace(/00+$/, ''), 'hex').toString('utf8').trim();
    }
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
    const lengthStart = offset * 2;
    const length = Number(BigInt(`0x${hex.slice(lengthStart, lengthStart + 64)}`));
    const dataStart = lengthStart + 64;
    return Buffer.from(hex.slice(dataStart, dataStart + length * 2), 'hex').toString('utf8').trim();
  } catch {
    return '';
  }
}

async function checkRpc() {
  const rpcUrl = value('QIE_RPC_URL');
  if (!rpcUrl) return;
  try {
    const chainIdHex = await rpc('eth_chainId');
    const chainId = BigInt(chainIdHex);
    if (chainId !== expectedChainId) {
      failures.push(`QIE_RPC_URL chain id is ${chainId}, expected ${expectedChainId}`);
    }
    console.log(`OK  rpc chain id ${chainId}`);
  } catch (err) {
    failures.push(`QIE_RPC_URL is not reachable: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const name of ['QANTARA_ADDRESS', 'QUSDC_ADDRESS']) {
    const address = value(name);
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
    try {
      const code = await rpc('eth_getCode', [address, 'latest']);
      if (!code || code === '0x') failures.push(`${name} has no contract code at ${address}`);
      else console.log(`OK  ${name} contract code present`);
    } catch (err) {
      failures.push(`${name} code check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const qusdc = value('QUSDC_ADDRESS');
  if (qusdc && /^0x[a-fA-F0-9]{40}$/.test(qusdc)) {
    try {
      const decimalsRaw = await rpc('eth_call', [{ to: qusdc, data: '0x313ce567' }, 'latest']);
      const decimals = Number(BigInt(decimalsRaw));
      if (!Number.isFinite(decimals) || decimals <= 0 || decimals > 36) {
        failures.push(`QUSDC_ADDRESS decimals() returned suspicious value ${decimals}`);
      } else {
        console.log(`OK  QUSDC decimals ${decimals}`);
      }
    } catch (err) {
      failures.push(`QUSDC_ADDRESS decimals() call failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const [label, selector] of [['symbol', '0x95d89b41'], ['name', '0x06fdde03']]) {
      try {
        const raw = await rpc('eth_call', [{ to: qusdc, data: selector }, 'latest']);
        const decoded = decodeAbiStringOrBytes32(raw);
        if (!decoded) {
          warnings.push(`QUSDC_ADDRESS ${label}() could not be decoded`);
          continue;
        }
        if (/\b(mock|fake|stub|test)\b/i.test(decoded)) {
          failures.push(`QUSDC_ADDRESS ${label}() returned non-production metadata: ${decoded}`);
        } else {
          console.log(`OK  QUSDC ${label} ${decoded}`);
        }
      } catch (err) {
        failures.push(`QUSDC_ADDRESS ${label}() call failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const capabilityChecks = [
      ['EIP-2612 permit domain', '0x3644e515'],
      ['EIP-2612 nonces', `0x7ecebe000000000000000000000000000000000000000000000000000000000000000000`],
      ['EIP-3009 authorizationState', `0xe94a010200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`],
    ];
    const supportedCapabilities = [];
    for (const [label, data] of capabilityChecks) {
      try {
        await rpc('eth_call', [{ to: qusdc, data }, 'latest']);
        supportedCapabilities.push(label);
      } catch {
        // Optional token acceleration paths; production may still use regular ERC-20 transfers.
      }
    }
    if (supportedCapabilities.length > 0) {
      console.log(`OK  QUSDC optional capabilities ${supportedCapabilities.join(', ')}`);
    } else {
      warnings.push('QUSDC_ADDRESS does not expose EIP-2612/EIP-3009 read surfaces; payment flow must use standard transfer verification');
    }
  }
}

function checkConsistency() {
  const frontend = value('QANTARA_FRONTEND_URL');
  const viteBackend = value('VITE_QANTARA_BACKEND_URL');
  const backend = value('QANTARA_BACKEND_URL');
  const cors = value('CORS_ORIGINS') || '';
  const corsOrigins = cors.split(',').map((item) => item.trim()).filter(Boolean);
  if (corsOrigins.includes('*')) failures.push('CORS_ORIGINS must not include wildcard origins');
  if (frontend && !cors.split(',').map((item) => item.trim()).includes(frontend)) {
    failures.push('CORS_ORIGINS must include QANTARA_FRONTEND_URL');
  }
  if (backend && viteBackend && backend !== viteBackend) {
    warnings.push('QANTARA_BACKEND_URL and VITE_QANTARA_BACKEND_URL differ; confirm this is intentional');
  }
  if (value('BOT_WEBHOOK_URL') && !value('WEBHOOK_SECRET')) {
    failures.push('BOT_WEBHOOK_URL requires WEBHOOK_SECRET');
  }
  if (value('ALERT_WEBHOOK_URL') && !value('ALERT_WEBHOOK_SECRET')) {
    failures.push('ALERT_WEBHOOK_URL requires ALERT_WEBHOOK_SECRET');
  }
  if (value('ALERT_CHAT_ID') && !value('ALERT_WEBHOOK_SECRET')) {
    failures.push('ALERT_CHAT_ID requires ALERT_WEBHOOK_SECRET');
  }
  if (value('BOT_TOKEN') && !value('QANTARA_API_KEY')) {
    failures.push('BOT_TOKEN requires QANTARA_API_KEY for bot backend access');
  }
  if (value('BOT_TOKEN') && !value('QANTARA_BACKEND_URL')) {
    failures.push('BOT_TOKEN requires QANTARA_BACKEND_URL');
  }
}

function checkForbiddenBrowserKeys() {
  for (const name of ['VITE_QANTARA_API_KEY', 'VITE_API_KEY', 'VITE_OPERATOR_API_KEY']) {
    if (value(name)) failures.push(`${name} must not be present in frontend build env`);
  }
}

function sameAddress(leftName, rightName) {
  const left = value(leftName);
  const right = value(rightName);
  if (!left || !right) return;
  if (!/^0x[a-fA-F0-9]{40}$/.test(left) || !/^0x[a-fA-F0-9]{40}$/.test(right)) return;
  if (left.toLowerCase() !== right.toLowerCase()) {
    failures.push(`${rightName} must match ${leftName}`);
  }
}

function checkFrontendAddressPairs() {
  const pairs = [
    ['QANTARA_ADDRESS', 'VITE_QANTARA_ADDRESS'],
    ['QANTARA_MULTIPAY_ADDRESS', 'VITE_QANTARA_MULTIPAY_ADDRESS'],
    ['QUSDC_ADDRESS', 'VITE_QUSDC_ADDRESS'],
    ['MILESTONE_ESCROW_ADDRESS', 'VITE_MILESTONE_ESCROW_ADDRESS'],
    ['RECURRING_SCHEDULER_ADDRESS', 'VITE_RECURRING_SCHEDULER_ADDRESS'],
    ['BATCH_PAYOUT_ADDRESS', 'VITE_BATCH_PAYOUT_ADDRESS'],
    ['QANTARA_CHAT_ADDRESS', 'VITE_QANTARA_CHAT_ADDRESS'],
    ['QANTARA_SPLITS_ADDRESS', 'VITE_QANTARA_SPLITS_ADDRESS'],
    ['QANTARA_SUBSCRIPTION_V2_ADDRESS', 'VITE_QANTARA_SUBSCRIPTION_V2_ADDRESS'],
    ['QANTARA_GAS_RELAY_ADDRESS', 'VITE_QANTARA_GAS_RELAY_ADDRESS'],
  ];
  for (const [left, right] of pairs) sameAddress(left, right);
}

function checkSecretUniqueness() {
  const names = ['API_KEY', 'WEBHOOK_SECRET', 'PAYMENT_INTENT_SECRET', 'SIWE_JWT_SECRET', 'ALERT_WEBHOOK_SECRET'];
  const seen = new Map();
  for (const name of names) {
    const current = value(name);
    if (!current) continue;
    const previous = seen.get(current);
    if (previous) failures.push(`${name} must not reuse ${previous}`);
    seen.set(current, name);
  }
}

console.log(`Qantara production preflight: ${envFile}`);

requireValue('API_KEY', { secret: true });
requireValue('WEBHOOK_SECRET', { secret: true });
requireValue('PAYMENT_INTENT_SECRET', { secret: true });
requireValue('SIWE_JWT_SECRET', { secret: true });
requireValue('QIE_RPC_URL', { url: true, publicUrl: true });
requireValue('QANTARA_ADDRESS', { address: true });
requireValue('QUSDC_ADDRESS', { address: true });
requireValue('QANTARA_FRONTEND_URL', { url: true, publicUrl: true });
requireValue('QANTARA_BACKEND_URL', { url: true, publicUrl: true });
requireValue('VITE_QANTARA_BACKEND_URL', { url: true, publicUrl: true });
requireValue('VITE_QANTARA_ADDRESS', { address: true });
requireValue('VITE_QUSDC_ADDRESS', { address: true });

checkConsistency();
checkForbiddenBrowserKeys();
checkFrontendAddressPairs();
checkSecretUniqueness();
await checkRpc();

for (const warning of warnings) console.warn(`WARN ${warning}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERR ${failure}`);
  process.exit(1);
}

console.log('OK  production preflight passed');
