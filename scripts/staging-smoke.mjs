#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const backendUrl = cleanUrl(
  process.env.BACKEND_URL
  || process.env.QANTARA_BACKEND_URL
  || process.env.VITE_QANTARA_BACKEND_URL,
);
const frontendUrl = cleanUrl(process.env.FRONTEND_URL || process.env.QANTARA_FRONTEND_URL);
const botUrl = cleanUrl(process.env.BOT_URL || process.env.BOT_WEBHOOK_URL);
const apiKey = process.env.API_KEY || process.env.QANTARA_API_KEY;
const invoiceHash = process.env.STAGING_INVOICE_HASH;
const payer = process.env.STAGING_PAYER_ADDRESS;
const txHash = process.env.STAGING_PAYMENT_TX_HASH;
const wallet = process.env.STAGING_WALLET_ADDRESS || payer;

const verifyPayment = process.env.STAGING_VERIFY_PAYMENT === 'true';
const testWebhook = process.env.STAGING_TEST_WEBHOOK === 'true';
const dispatchAlerts = process.env.STAGING_DISPATCH_ALERTS === 'true';
const strict = process.env.STAGING_STRICT === 'true';
const reportPath = process.env.STAGING_REPORT_PATH
  ? resolve(process.env.STAGING_REPORT_PATH)
  : undefined;

const failures = [];
const checks = [];
const report = {
  startedAt: new Date().toISOString(),
  mode: strict ? 'strict' : 'read-only',
  backendUrl,
  frontendUrl,
  botUrl,
  invoiceHash,
  payer,
  txHash,
  checks,
  artifacts: {},
};
let reportWritten = false;

function cleanUrl(value) {
  return value?.trim().replace(/\/$/, '');
}

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const marker = ok ? 'OK ' : 'ERR';
  console.log(`${marker} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

function skipOrFail(name, detail) {
  record(name, !strict, strict ? `required in STAGING_STRICT=true: ${detail}` : `skipped: ${detail}`);
}

function requireValue(name, value) {
  if (!value) {
    record(`env:${name}`, false, 'required for staging smoke');
    return false;
  }
  record(`env:${name}`, true);
  return true;
}

async function request(path, {
  method = 'GET',
  auth = false,
  body,
  expect = [200],
  text = false,
} = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${apiKey}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${backendUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = text ? await res.text() : await res.json().catch(() => ({}));
  const ok = expect.includes(res.status);
  return { ok, status: res.status, payload };
}

async function absoluteRequest(url, { expect = [200], text = true } = {}) {
  const res = await fetch(url);
  const payload = text ? await res.text() : await res.json().catch(() => ({}));
  return { ok: expect.includes(res.status), status: res.status, payload };
}

async function checkRequest(name, path, options) {
  try {
    const result = await request(path, options);
    const summary = typeof result.payload === 'string'
      ? result.payload.slice(0, 120)
      : JSON.stringify(result.payload).slice(0, 180);
    record(name, result.ok, `HTTP ${result.status}${summary ? ` ${summary}` : ''}`);
    return result;
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
    return { ok: false, status: 0, payload: null };
  }
}

async function checkAbsolute(name, url, options) {
  try {
    const result = await absoluteRequest(url, options);
    const summary = typeof result.payload === 'string'
      ? result.payload.replace(/\s+/g, ' ').slice(0, 120)
      : JSON.stringify(result.payload).slice(0, 180);
    record(name, result.ok, `HTTP ${result.status}${summary ? ` ${summary}` : ''}`);
    return result;
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
    return { ok: false, status: 0, payload: null };
  }
}

function hasEvent(payload, pattern) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.some((event) => pattern.test(String(event.type ?? event.eventType ?? '')));
}

function assertPayload(name, ok, detail = '') {
  record(name, Boolean(ok), detail);
}

function writeReport() {
  if (!reportPath || reportWritten) return;
  report.finishedAt = new Date().toISOString();
  report.ok = failures.length === 0;
  report.failures = [...failures];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  reportWritten = true;
  console.log(`Report written to ${reportPath}`);
}

async function main() {
  if (!requireValue('BACKEND_URL/QANTARA_BACKEND_URL', backendUrl)) {
    process.exitCode = 2;
    return;
  }
  if (!requireValue('API_KEY/QANTARA_API_KEY', apiKey)) {
    process.exitCode = 2;
    return;
  }
  if (strict) {
    requireValue('FRONTEND_URL/QANTARA_FRONTEND_URL', frontendUrl);
    requireValue('BOT_URL/BOT_WEBHOOK_URL', botUrl);
    requireValue('STAGING_INVOICE_HASH', invoiceHash);
    requireValue('STAGING_PAYER_ADDRESS', payer);
    requireValue('STAGING_PAYMENT_TX_HASH', txHash);
    assertPayload('strict payment verification enabled', verifyPayment, 'set STAGING_VERIFY_PAYMENT=true');
    assertPayload('strict webhook test enabled', testWebhook, 'set STAGING_TEST_WEBHOOK=true');
    assertPayload('strict alert dispatch enabled', dispatchAlerts, 'set STAGING_DISPATCH_ALERTS=true');
  }

  const health = await checkRequest('public health', '/v1/health');
  if (health.ok) {
    assertPayload('health db ok', health.payload?.db === 'ok', JSON.stringify({ db: health.payload?.db }));
    assertPayload('health rpc ok', health.payload?.rpc?.ok === true, JSON.stringify(health.payload?.rpc ?? {}));
    assertPayload('health migrations present', typeof health.payload?.migrations?.current === 'string', JSON.stringify(health.payload?.migrations ?? {}));
    report.artifacts.health = {
      db: health.payload?.db,
      rpc: health.payload?.rpc,
      migrations: health.payload?.migrations,
      indexer: health.payload?.indexer,
    };
  }
  const metrics = await checkRequest('public metrics', '/v1/metrics', { text: true });
  if (metrics.ok && typeof metrics.payload === 'string') {
    assertPayload('metrics backend up', /qantara_backend_up 1/.test(metrics.payload));
    assertPayload('metrics rpc up', /qantara_rpc_up 1/.test(metrics.payload));
    assertPayload('metrics indexer safety exported', /qantara_indexer_confirmations \d+/.test(metrics.payload));
  }
  const settings = await checkRequest('settings status', '/v1/settings/status', { auth: true });
  if (settings.ok) {
    report.artifacts.settings = {
      backend: settings.payload?.backend,
      contracts: settings.payload?.contracts,
      telegram: settings.payload?.telegram,
      security: settings.payload?.security,
      operational: settings.payload?.operational,
    };
  }
  await checkRequest('deployment registry', '/v1/deployments/status', { auth: true });
  const chainStatus = await checkRequest('chain status', '/v1/chain/status', { auth: true });
  if (chainStatus.ok && chainStatus.payload?.rpc) {
    record('rpc configured', Boolean(chainStatus.payload.rpc.configured !== false), JSON.stringify(chainStatus.payload.rpc).slice(0, 160));
  }
  if (chainStatus.ok) {
    record('qantara contract configured', Boolean(chainStatus.payload.contractAddress), chainStatus.payload.contractAddress || 'missing');
    assertPayload('chain status safety exported', typeof chainStatus.payload?.safety?.confirmations === 'number');
    report.artifacts.chain = {
      rpc: chainStatus.payload?.rpc,
      contractAddress: chainStatus.payload?.contractAddress,
      cursors: chainStatus.payload?.cursors,
      safety: chainStatus.payload?.safety,
      runtime: chainStatus.payload?.runtime,
    };
  }

  if (frontendUrl) {
    await checkAbsolute('frontend root', `${frontendUrl}/`);
    await checkAbsolute('frontend start route', `${frontendUrl}/app/start`);
  } else {
    skipOrFail('frontend checks', 'set FRONTEND_URL or QANTARA_FRONTEND_URL');
  }

  if (botUrl) {
    await checkAbsolute('telegram bot health', `${botUrl}/health`, { text: false });
  } else {
    skipOrFail('telegram bot health', 'set BOT_URL or BOT_WEBHOOK_URL');
  }

  if (wallet) {
    await checkRequest('onramp order read', `/v1/onramp/orders?wallet=${encodeURIComponent(wallet)}`, { auth: true });
  } else {
    skipOrFail('onramp order read', 'set STAGING_WALLET_ADDRESS to check provider order persistence');
  }

  let publicInvoice;
  let timeline;
  let merchant;
  if (invoiceHash) {
    publicInvoice = await checkRequest('public invoice read', `/v1/invoices/${encodeURIComponent(invoiceHash)}`, { expect: strict ? [200] : [200, 404] });
    if (publicInvoice.ok && publicInvoice.status === 200) {
      merchant = publicInvoice.payload?.merchant;
      report.artifacts.invoice = {
        hash: publicInvoice.payload?.hash,
        merchant,
        payer: publicInvoice.payload?.payer,
        token: publicInvoice.payload?.token,
        amount: publicInvoice.payload?.amount,
        status: publicInvoice.payload?.status,
        paidTxHash: publicInvoice.payload?.paidTxHash,
      };
      assertPayload('invoice has no webhook secret fields', !('webhookUrl' in publicInvoice.payload) && !('webhookEvents' in publicInvoice.payload));
    }
    timeline = await checkRequest('invoice timeline', `/v1/invoices/${encodeURIComponent(invoiceHash)}/events`, { expect: strict ? [200] : [200, 401, 403, 404] });
    if (timeline.ok && timeline.status === 200) {
      report.artifacts.timeline = {
        count: Array.isArray(timeline.payload?.events) ? timeline.payload.events.length : undefined,
        types: Array.isArray(timeline.payload?.events) ? timeline.payload.events.map((event) => event.type ?? event.eventType) : [],
      };
    }
    const deliveries = await checkRequest('webhook deliveries', `/v1/webhooks/deliveries?invoice_hash=${encodeURIComponent(invoiceHash)}`, { auth: true });
    if (deliveries.ok) {
      report.artifacts.webhookDeliveries = {
        count: deliveries.payload?.count,
        total: deliveries.payload?.total,
      };
    }
  } else {
    skipOrFail('invoice scoped checks', 'set STAGING_INVOICE_HASH after creating a real invoice');
  }

  if (testWebhook) {
    if (!invoiceHash) record('webhook test', false, 'STAGING_INVOICE_HASH is required');
    else {
      const webhookTest = await checkRequest('webhook test', '/v1/webhooks/test', {
        method: 'POST',
        auth: true,
        body: { invoice_hash: invoiceHash },
        expect: strict ? [200] : [200, 400, 404],
      });
      report.artifacts.webhookTest = webhookTest.payload;
    }
  } else if (strict) {
    record('webhook test', false, 'set STAGING_TEST_WEBHOOK=true');
  }

  if (verifyPayment) {
    if (!invoiceHash || !payer || !txHash) {
      record('payment verification', false, 'STAGING_INVOICE_HASH, STAGING_PAYER_ADDRESS, and STAGING_PAYMENT_TX_HASH are required');
    } else {
      const verified = await checkRequest('payment verification', `/v1/invoices/${encodeURIComponent(invoiceHash)}/verify-payment`, {
        method: 'POST',
        body: { payer, tx_hash: txHash },
        expect: [200],
      });
      report.artifacts.paymentVerification = verified.payload;
      const paidInvoice = await checkRequest('paid invoice readback', `/v1/invoices/${encodeURIComponent(invoiceHash)}`, { expect: [200] });
      if (paidInvoice.ok) {
        report.artifacts.paidInvoice = {
          hash: paidInvoice.payload?.hash,
          status: paidInvoice.payload?.status,
          paidTxHash: paidInvoice.payload?.paidTxHash,
          paidAt: paidInvoice.payload?.paidAt,
        };
        assertPayload('paid invoice uses supplied tx hash', String(paidInvoice.payload?.paidTxHash ?? '').toLowerCase() === txHash.toLowerCase());
      }
      const receipt = await checkRequest('receipt readback', `/v1/receipts/${encodeURIComponent(invoiceHash)}`, { expect: [200] });
      if (receipt.ok) {
        report.artifacts.receipt = {
          id: receipt.payload?.id,
          invoiceHash: receipt.payload?.invoiceHash,
          txHash: receipt.payload?.txHash,
          receiptHash: receipt.payload?.receiptHash,
        };
        assertPayload('receipt uses supplied tx hash', String(receipt.payload?.txHash ?? '').toLowerCase() === txHash.toLowerCase());
      }
      const paidTimeline = await checkRequest('paid timeline readback', `/v1/invoices/${encodeURIComponent(invoiceHash)}/events`, { expect: [200] });
      if (paidTimeline.ok) {
        assertPayload('timeline contains payment event', hasEvent(paidTimeline.payload, /payment|paid|settled/i));
        assertPayload('timeline contains receipt event', hasEvent(paidTimeline.payload, /receipt/i));
      }
    }
  } else {
    skipOrFail('payment verification', 'set STAGING_VERIFY_PAYMENT=true only after a real payment tx exists');
  }

  if (merchant) {
    const notifications = await checkRequest('notifications read', `/v1/notifications?merchant=${encodeURIComponent(merchant)}`, {
      auth: true,
      expect: [200, 403],
    });
    if (strict) assertPayload('notifications readable with merchant-scoped key', notifications.status === 200, `HTTP ${notifications.status}`);
    report.artifacts.notifications = {
      status: notifications.status,
      count: notifications.payload?.count,
      total: notifications.payload?.total,
    };
  } else {
    skipOrFail('notifications read', 'invoice merchant is required');
  }

  if (dispatchAlerts) {
    await checkRequest('alert dispatch', '/v1/alerts/dispatch', {
      method: 'POST',
      auth: true,
      body: {},
      expect: [200, 403],
    });
    await delay(500);
    const alertDeliveries = await checkRequest('alert deliveries', '/v1/alerts/deliveries', { auth: true });
    report.artifacts.alertDeliveries = {
      status: alertDeliveries.status,
      count: alertDeliveries.payload?.count,
      total: alertDeliveries.payload?.total,
    };
  } else if (strict) {
    record('alert dispatch', false, 'set STAGING_DISPATCH_ALERTS=true');
  }

  if (failures.length > 0) {
    console.error(`\nStaging smoke failed: ${failures.join(', ')}`);
    writeReport();
    process.exitCode = 1;
    return;
  }

  console.log(`\nStaging smoke passed (${checks.length} checks).`);
  writeReport();
}

try {
  await main();
} finally {
  if (process.exitCode && reportPath) writeReport();
}
