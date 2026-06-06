#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ZERO = '0x0000000000000000000000000000000000000000';

const backendUrl = cleanUrl(
  process.env.BACKEND_URL
  || process.env.QANTARA_BACKEND_URL
  || process.env.VITE_QANTARA_BACKEND_URL,
);
const rpcUrl = cleanUrl(process.env.QIE_NATIVE_RPC_URL || process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital');
const qantaraAddress = normalizeAddress(process.env.QANTARA_ADDRESS || process.env.VITE_QANTARA_ADDRESS);
const invoiceHash = normalizeHash(process.env.QIE_NATIVE_INVOICE_HASH || process.env.STAGING_INVOICE_HASH);
const payerAddress = normalizeAddress(process.env.QIE_NATIVE_PAYER_ADDRESS || process.env.STAGING_PAYER_ADDRESS);
const merchantAddressInput = normalizeAddress(process.env.QIE_NATIVE_MERCHANT_ADDRESS);
const paymentTxHash = normalizeHash(process.env.QIE_NATIVE_PAYMENT_TX_HASH || process.env.STAGING_PAYMENT_TX_HASH);
const amountInput = process.env.QIE_NATIVE_AMOUNT;
const expectPayment = process.env.QIE_NATIVE_EXPECT_PAYMENT === 'true';
const paymentMode = process.env.QIE_NATIVE_PAYMENT_MODE || 'auto';
const reportPath = process.env.QIE_NATIVE_REPORT_PATH ? resolve(process.env.QIE_NATIVE_REPORT_PATH) : undefined;

const checks = [];
const failures = [];
const report = {
  startedAt: new Date().toISOString(),
  backendUrl,
  rpcUrl,
  qantaraAddress,
  invoiceHash,
  payerAddress,
  merchantAddress: merchantAddressInput,
  paymentTxHash,
  expectPayment,
  paymentMode,
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
    record(`env:${name}`, false, 'required for native QIE smoke');
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
    signal: AbortSignal.timeout(Number(process.env.QIE_NATIVE_RPC_TIMEOUT_MS || '10000')),
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

function parseUnits(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(String(value ?? ''))) throw new Error(`Invalid amount: ${value}`);
  const [whole, fraction = ''] = String(value).split('.');
  if (fraction.length > decimals) throw new Error(`Amount ${value} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction.padEnd(decimals, '0') || '0'));
}

function topicAddress(topic) {
  return `0x${String(topic).slice(-40)}`.toLowerCase();
}

function findQantaraPaidEvent(receipt, { contract, invoice, payer, requiredAmount }) {
  if (!contract || !invoice || !payer) return undefined;
  for (const log of receipt.logs ?? []) {
    if (String(log.address).toLowerCase() !== contract) continue;
    const topics = (log.topics ?? []).map((topic) => String(topic).toLowerCase());
    if (topics.length < 3) continue;
    if (topics[1] !== invoice) continue;
    if (topicAddress(topics[2]) !== payer) continue;
    const amount = BigInt(log.data || '0x0');
    if (amount >= requiredAmount) return { invoiceHash: invoice, payer, amount: amount.toString() };
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
  const chainId = Number(BigInt(await rpc('eth_chainId')));
  record('rpc chain id is QIE mainnet', chainId === Number(process.env.EXPECTED_CHAIN_ID || '1990'), `chainId=${chainId}`);

  if (qantaraAddress) {
    const code = await rpc('eth_getCode', [qantaraAddress, 'latest']);
    record('Qantara contract code present', Boolean(code && code !== '0x'), qantaraAddress);
    report.artifacts.contract = { address: qantaraAddress, codePresent: Boolean(code && code !== '0x') };
  } else {
    record('Qantara contract address configured', paymentMode !== 'contract', 'required only for contract payment validation');
  }

  let amount = amountInput;
  let merchantAddress = merchantAddressInput;
  if (backendUrl && invoiceHash) {
    const invoice = await backendRequest(`/v1/invoices/${encodeURIComponent(invoiceHash)}`, { expect: [200] });
    record('backend invoice read', invoice.ok, `HTTP ${invoice.status}`);
    if (invoice.ok) {
      const token = String(invoice.payload?.token ?? '').toLowerCase();
      record('invoice token is native QIE', token === ZERO || token === 'qie', token || 'missing');
      amount = amount ?? invoice.payload?.amount;
      merchantAddress = merchantAddress ?? normalizeAddress(invoice.payload?.merchant);
      report.artifacts.invoice = {
        hash: invoice.payload?.hash,
        merchant: invoice.payload?.merchant,
        token: invoice.payload?.token,
        amount: invoice.payload?.amount,
        status: invoice.payload?.status,
      };
    }
  } else if (expectPayment) {
    requireValue('BACKEND_URL/QANTARA_BACKEND_URL and QIE_NATIVE_INVOICE_HASH', backendUrl && invoiceHash);
  }

  if (expectPayment || paymentTxHash) {
    requireValue('QIE_NATIVE_PAYMENT_TX_HASH/STAGING_PAYMENT_TX_HASH', paymentTxHash);
    requireValue('QIE_NATIVE_PAYER_ADDRESS/STAGING_PAYER_ADDRESS', payerAddress);
    requireValue('QIE_NATIVE_MERCHANT_ADDRESS or invoice merchant', merchantAddress);
    requireValue('QIE_NATIVE_AMOUNT or invoice amount', amount);
    if (!paymentTxHash || !payerAddress || !merchantAddress || !amount) {
      process.exitCode = 2;
      return;
    }

    const requiredAmount = parseUnits(amount, 18);
    const [tx, receipt] = await Promise.all([
      rpc('eth_getTransactionByHash', [paymentTxHash]),
      rpc('eth_getTransactionReceipt', [paymentTxHash]),
    ]);
    record('native payment tx receipt success', receipt?.status === '0x1', `status=${receipt?.status ?? 'missing'}`);
    record('native payment sender matches payer', String(tx?.from ?? '').toLowerCase() === payerAddress, String(tx?.from ?? 'missing'));

    const txTo = normalizeAddress(tx?.to);
    const txValue = BigInt(tx?.value || '0x0');
    const directPayment = txTo === merchantAddress && txValue >= requiredAmount;
    const contractEvent = findQantaraPaidEvent(receipt, {
      contract: qantaraAddress,
      invoice: invoiceHash,
      payer: payerAddress,
      requiredAmount,
    });
    const contractPayment = txTo === qantaraAddress && Boolean(contractEvent);

    if (paymentMode === 'direct') {
      record('direct native transfer matches invoice', directPayment, `to=${txTo ?? 'missing'} value=${txValue.toString()}`);
    } else if (paymentMode === 'contract') {
      record('contract native payment event matches invoice', contractPayment, contractEvent ? JSON.stringify(contractEvent) : `to=${txTo ?? 'missing'}`);
    } else {
      record(
        'native payment matches direct or contract path',
        directPayment || contractPayment,
        directPayment ? `direct value=${txValue.toString()}` : contractEvent ? `contract ${JSON.stringify(contractEvent)}` : `to=${txTo ?? 'missing'} value=${txValue.toString()}`,
      );
    }
    report.artifacts.payment = {
      txHash: paymentTxHash,
      payer: payerAddress,
      merchant: merchantAddress,
      amount,
      requiredAmount: requiredAmount.toString(),
      txTo,
      txValue: txValue.toString(),
      directPayment,
      contractPayment,
      contractEvent,
    };

    if (backendUrl && invoiceHash) {
      const verified = await backendRequest(`/v1/invoices/${encodeURIComponent(invoiceHash)}/verify-payment`, {
        method: 'POST',
        body: { payer: payerAddress, tx_hash: paymentTxHash },
        expect: [200],
      });
      record('backend verifies native QIE payment', verified.ok, `HTTP ${verified.status}`);
      report.artifacts.backendVerification = verified.payload;

      const receiptRead = await backendRequest(`/v1/receipts/${encodeURIComponent(invoiceHash)}`, { expect: [200] });
      record('backend native receipt readback', receiptRead.ok, `HTTP ${receiptRead.status}`);
      if (receiptRead.ok) {
        record('receipt uses native tx hash', String(receiptRead.payload?.txHash ?? '').toLowerCase() === paymentTxHash, String(receiptRead.payload?.txHash ?? 'missing'));
        report.artifacts.receipt = receiptRead.payload;
      }

      const timeline = await backendRequest(`/v1/invoices/${encodeURIComponent(invoiceHash)}/events`, { expect: [200] });
      record('backend native timeline readback', timeline.ok, `HTTP ${timeline.status}`);
      if (timeline.ok) {
        const types = Array.isArray(timeline.payload?.events) ? timeline.payload.events.map((event) => event.type ?? event.eventType) : [];
        record('timeline includes payment/receipt state', types.some((type) => /payment|paid|receipt/i.test(String(type))), types.join(',') || 'empty');
        report.artifacts.timeline = { types };
      }
    }
  } else {
    record('native payment tx checks', true, 'skipped: set QIE_NATIVE_EXPECT_PAYMENT=true with a real QIE payment tx');
  }

  if (failures.length > 0) {
    console.error(`\nNative QIE smoke failed: ${failures.join(', ')}`);
    writeReport();
    process.exit(1);
  }
  console.log(`\nNative QIE smoke passed (${checks.length} checks).`);
  writeReport();
}

try {
  await main();
} finally {
  if (process.exitCode && reportPath) writeReport();
}
