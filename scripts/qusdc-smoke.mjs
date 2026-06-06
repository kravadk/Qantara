#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ZERO = '0x0000000000000000000000000000000000000000';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const backendUrl = cleanUrl(
  process.env.BACKEND_URL
  || process.env.QANTARA_BACKEND_URL
  || process.env.VITE_QANTARA_BACKEND_URL,
);
const rpcUrl = cleanUrl(process.env.QUSDC_RPC_URL || process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital');
const qusdcAddress = normalizeAddress(process.env.QUSDC_ADDRESS || process.env.VITE_QUSDC_ADDRESS || process.env.E2E_QUSDC_ADDRESS);
const invoiceHash = process.env.QUSDC_INVOICE_HASH || process.env.STAGING_INVOICE_HASH;
const payerAddress = normalizeAddress(process.env.QUSDC_PAYER_ADDRESS || process.env.STAGING_PAYER_ADDRESS);
const merchantAddressInput = normalizeAddress(process.env.QUSDC_MERCHANT_ADDRESS);
const paymentTxHash = normalizeHash(process.env.QUSDC_PAYMENT_TX_HASH || process.env.STAGING_PAYMENT_TX_HASH);
const amountInput = process.env.QUSDC_AMOUNT;
const expectPayment = process.env.QUSDC_EXPECT_PAYMENT === 'true';
const reportPath = process.env.QUSDC_REPORT_PATH ? resolve(process.env.QUSDC_REPORT_PATH) : undefined;

const checks = [];
const failures = [];
const report = {
  startedAt: new Date().toISOString(),
  backendUrl,
  rpcUrl,
  qusdcAddress,
  invoiceHash,
  payerAddress,
  merchantAddress: merchantAddressInput,
  paymentTxHash,
  expectPayment,
  checks,
  artifacts: {},
};

function cleanUrl(value) {
  return value?.trim().replace(/\/$/, '');
}

function normalizeAddress(value) {
  const current = value?.trim();
  return current && /^0x[a-fA-F0-9]{40}$/.test(current) ? current.toLowerCase() : undefined;
}

function normalizeHash(value) {
  const current = value?.trim();
  return current && /^0x[a-fA-F0-9]{64}$/.test(current) ? current.toLowerCase() : undefined;
}

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'OK ' : 'ERR'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

function requireValue(name, value) {
  if (!value) {
    record(`env:${name}`, false, 'required for QUSDC smoke');
    return false;
  }
  record(`env:${name}`, true);
  return true;
}

async function rpc(method, params = []) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(Number(process.env.QUSDC_RPC_TIMEOUT_MS || '10000')),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || body.error.code}`);
  return body.result;
}

async function backendRequest(path, { method = 'GET', body, expect = [200] } = {}) {
  if (!backendUrl) return { ok: false, status: 0, payload: null };
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${backendUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: expect.includes(res.status), status: res.status, payload };
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

function parseUnits(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(String(value ?? ''))) throw new Error(`Invalid amount: ${value}`);
  const [whole, fraction = ''] = String(value).split('.');
  if (fraction.length > decimals) throw new Error(`Amount ${value} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction.padEnd(decimals, '0') || '0'));
}

function topicAddress(topic) {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function findTransfer(receipt, { token, payer, merchant, requiredAmount }) {
  for (const log of receipt.logs ?? []) {
    const topics = (log.topics ?? []).map((topic) => String(topic).toLowerCase());
    if (String(log.address).toLowerCase() !== token) continue;
    if (topics[0] !== TRANSFER_TOPIC || topics.length < 3) continue;
    const from = topicAddress(topics[1]);
    const to = topicAddress(topics[2]);
    const value = BigInt(log.data || '0x0');
    if (from === payer && to === merchant && value >= requiredAmount) {
      return { from, to, value: value.toString() };
    }
  }
  return undefined;
}

function writeReport() {
  if (!reportPath) return;
  report.finishedAt = new Date().toISOString();
  report.ok = failures.length === 0;
  report.failures = [...failures];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${reportPath}`);
}

async function main() {
  requireValue('QUSDC_ADDRESS/VITE_QUSDC_ADDRESS', qusdcAddress);
  if (!qusdcAddress) {
    process.exitCode = 2;
    return;
  }

  const chainId = Number(BigInt(await rpc('eth_chainId')));
  record('rpc chain id is QIE mainnet', chainId === Number(process.env.EXPECTED_CHAIN_ID || '1990'), `chainId=${chainId}`);

  const code = await rpc('eth_getCode', [qusdcAddress, 'latest']);
  record('QUSDC contract code present', Boolean(code && code !== '0x'), qusdcAddress);

  const decimals = Number(BigInt(await rpc('eth_call', [{ to: qusdcAddress, data: '0x313ce567' }, 'latest'])));
  record('QUSDC decimals valid', Number.isFinite(decimals) && decimals > 0 && decimals <= 36, `decimals=${decimals}`);

  const symbol = decodeAbiStringOrBytes32(await rpc('eth_call', [{ to: qusdcAddress, data: '0x95d89b41' }, 'latest']));
  const name = decodeAbiStringOrBytes32(await rpc('eth_call', [{ to: qusdcAddress, data: '0x06fdde03' }, 'latest']));
  record('QUSDC symbol readable', Boolean(symbol), symbol || 'empty');
  record('QUSDC name readable', Boolean(name), name || 'empty');
  record('QUSDC metadata production label', !/\b(mock|fake|stub|test)\b/i.test(`${symbol} ${name}`), `${symbol} ${name}`.trim());

  const capabilityChecks = [
    ['permit domain', '0x3644e515'],
    ['permit nonces', `0x7ecebe000000000000000000000000000000000000000000000000000000000000000000`],
    ['EIP-3009 authorizationState', `0xe94a010200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`],
  ];
  const capabilities = [];
  for (const [label, data] of capabilityChecks) {
    try {
      await rpc('eth_call', [{ to: qusdcAddress, data }, 'latest']);
      capabilities.push(label);
    } catch {
      // Optional acceleration path; standard ERC-20 transfer verification remains valid.
    }
  }
  record('QUSDC optional capabilities checked', true, capabilities.length ? capabilities.join(', ') : 'standard transfer verification only');

  report.artifacts.token = {
    chainId,
    address: qusdcAddress,
    decimals,
    symbol,
    name,
    capabilities,
  };

  let merchantAddress = merchantAddressInput;
  let amount = amountInput;
  if (invoiceHash && backendUrl) {
    const invoice = await backendRequest(`/v1/invoices/${encodeURIComponent(invoiceHash)}`, { expect: [200] });
    record('backend QUSDC invoice read', invoice.ok, `HTTP ${invoice.status}`);
    if (invoice.ok) {
      merchantAddress = normalizeAddress(invoice.payload?.merchant) ?? merchantAddress;
      amount = invoice.payload?.amount ?? amount;
      record('invoice token matches QUSDC', String(invoice.payload?.token ?? '').toLowerCase() === qusdcAddress, String(invoice.payload?.token ?? 'missing'));
      report.artifacts.invoice = {
        hash: invoice.payload?.hash,
        merchant: invoice.payload?.merchant,
        payer: invoice.payload?.payer,
        token: invoice.payload?.token,
        amount: invoice.payload?.amount,
        status: invoice.payload?.status,
      };
    }
  } else if (expectPayment) {
    requireValue('BACKEND_URL/QANTARA_BACKEND_URL and QUSDC_INVOICE_HASH', backendUrl && invoiceHash);
  }

  if (expectPayment || paymentTxHash) {
    requireValue('QUSDC_PAYMENT_TX_HASH/STAGING_PAYMENT_TX_HASH', paymentTxHash);
    requireValue('QUSDC_PAYER_ADDRESS/STAGING_PAYER_ADDRESS', payerAddress);
    requireValue('QUSDC_MERCHANT_ADDRESS or invoice merchant', merchantAddress);
    requireValue('QUSDC_AMOUNT or invoice amount', amount);
    if (!paymentTxHash || !payerAddress || !merchantAddress || !amount) {
      process.exitCode = 2;
      return;
    }

    const receipt = await rpc('eth_getTransactionReceipt', [paymentTxHash]);
    record('QUSDC payment tx receipt success', receipt?.status === '0x1', `status=${receipt?.status ?? 'missing'}`);
    const requiredAmount = parseUnits(amount, decimals);
    const transfer = findTransfer(receipt, {
      token: qusdcAddress,
      payer: payerAddress,
      merchant: merchantAddress,
      requiredAmount,
    });
    record('QUSDC Transfer matches invoice', Boolean(transfer), transfer ? JSON.stringify(transfer) : 'no matching Transfer log');
    report.artifacts.payment = {
      txHash: paymentTxHash,
      payer: payerAddress,
      merchant: merchantAddress,
      amount,
      requiredAmount: requiredAmount.toString(),
      transfer,
    };

    if (backendUrl && invoiceHash) {
      const verified = await backendRequest(`/v1/invoices/${encodeURIComponent(invoiceHash)}/verify-payment`, {
        method: 'POST',
        body: { payer: payerAddress, tx_hash: paymentTxHash },
        expect: [200],
      });
      record('backend verifies QUSDC payment', verified.ok, `HTTP ${verified.status}`);
      report.artifacts.backendVerification = verified.payload;

      const receiptRead = await backendRequest(`/v1/receipts/${encodeURIComponent(invoiceHash)}`, { expect: [200] });
      record('backend QUSDC receipt readback', receiptRead.ok, `HTTP ${receiptRead.status}`);
      if (receiptRead.ok) {
        record('receipt uses QUSDC tx hash', String(receiptRead.payload?.txHash ?? '').toLowerCase() === paymentTxHash, String(receiptRead.payload?.txHash ?? 'missing'));
        report.artifacts.receipt = receiptRead.payload;
      }

      const timeline = await backendRequest(`/v1/invoices/${encodeURIComponent(invoiceHash)}/events`, { expect: [200] });
      record('backend QUSDC timeline readback', timeline.ok, `HTTP ${timeline.status}`);
      if (timeline.ok) {
        const types = Array.isArray(timeline.payload?.events) ? timeline.payload.events.map((event) => event.type ?? event.eventType) : [];
        record('timeline includes payment/receipt state', types.some((type) => /payment|paid|receipt/i.test(String(type))), types.join(',') || 'empty');
        report.artifacts.timeline = { types };
      }
    }
  } else {
    record('QUSDC payment tx checks', true, 'skipped: set QUSDC_EXPECT_PAYMENT=true with a real QUSDC payment tx');
  }

  if (failures.length > 0) {
    console.error(`\nQUSDC smoke failed: ${failures.join(', ')}`);
    writeReport();
    process.exit(1);
  }
  console.log(`\nQUSDC smoke passed (${checks.length} checks).`);
  writeReport();
}

try {
  await main();
} finally {
  if (process.exitCode && reportPath) writeReport();
}
