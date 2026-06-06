#!/usr/bin/env node
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const backendUrl = cleanUrl(
  process.env.BACKEND_URL
  || process.env.QANTARA_BACKEND_URL
  || process.env.VITE_QANTARA_BACKEND_URL,
);
const botUrl = cleanUrl(process.env.BOT_URL || process.env.BOT_WEBHOOK_URL);
const apiKey = process.env.API_KEY || process.env.QANTARA_API_KEY;
const webhookSecret = process.env.WEBHOOK_SECRET;
const alertWebhookSecret = process.env.ALERT_WEBHOOK_SECRET;
const invoiceHash = normalizeHash(process.env.TELEGRAM_INVOICE_HASH || process.env.STAGING_INVOICE_HASH);
const chatId = process.env.TELEGRAM_CHAT_ID || process.env.ALERT_CHAT_ID;
const creatorId = process.env.TELEGRAM_CREATOR_ID;
const expectDelivery = process.env.TELEGRAM_EXPECT_DELIVERY === 'true';
const reportPath = process.env.TELEGRAM_REPORT_PATH ? resolve(process.env.TELEGRAM_REPORT_PATH) : undefined;

const checks = [];
const failures = [];
const report = {
  startedAt: new Date().toISOString(),
  backendUrl,
  botUrl,
  invoiceHash,
  chatId,
  expectDelivery,
  checks,
  artifacts: {},
};

function cleanUrl(value) {
  return value?.trim().replace(/\/$/, '');
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
    record(`env:${name}`, false, 'required for Telegram smoke');
    return false;
  }
  record(`env:${name}`, true);
  return true;
}

function skipOrFail(name, detail) {
  record(name, !expectDelivery, expectDelivery ? `required with TELEGRAM_EXPECT_DELIVERY=true: ${detail}` : `skipped: ${detail}`);
}

async function jsonRequest(url, { method = 'GET', headers = {}, body, expect = [200] } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.TELEGRAM_SMOKE_TIMEOUT_MS || '15000')),
  });
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }
  return { ok: expect.includes(res.status), status: res.status, payload };
}

async function backendRequest(path, options = {}) {
  const headers = {};
  if (options.auth) headers.Authorization = `Bearer ${apiKey}`;
  return jsonRequest(`${backendUrl}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
}

function signPayload(secret, body) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    timestamp,
    signature: createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'),
  };
}

async function signedBotWebhook(path, secret, payload, expect) {
  const body = JSON.stringify(payload);
  const signed = signPayload(secret, body);
  return jsonRequest(`${botUrl}${path}`, {
    method: 'POST',
    body,
    expect,
    headers: {
      'X-Qantara-Timestamp': String(signed.timestamp),
      'X-Qantara-Signature': signed.signature,
      'X-Qantara-Event-Type': payload.type,
    },
  });
}

function summarize(result) {
  return `HTTP ${result.status} ${typeof result.payload === 'string' ? result.payload.slice(0, 160) : JSON.stringify(result.payload).slice(0, 220)}`;
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
  const hasBot = requireValue('BOT_URL/BOT_WEBHOOK_URL', botUrl);
  const hasBackend = requireValue('BACKEND_URL/QANTARA_BACKEND_URL', backendUrl);
  const hasApiKey = requireValue('API_KEY/QANTARA_API_KEY', apiKey);
  if (!hasBot || !hasBackend || !hasApiKey) {
    process.exitCode = 2;
    return;
  }

  const botHealth = await jsonRequest(`${botUrl}/health`);
  record('telegram bot health', botHealth.ok, summarize(botHealth));
  if (botHealth.ok) {
    report.artifacts.botHealth = botHealth.payload;
    if (webhookSecret) record('bot qantara webhook enabled', botHealth.payload?.qantaraWebhook === true, JSON.stringify(botHealth.payload));
    if (alertWebhookSecret && expectDelivery) record('bot alert webhook enabled', botHealth.payload?.alerts === true, JSON.stringify(botHealth.payload));
  }

  const backendHealth = await backendRequest('/v1/health');
  record('backend health', backendHealth.ok, summarize(backendHealth));
  if (backendHealth.ok) {
    report.artifacts.backendHealth = {
      db: backendHealth.payload?.db,
      rpc: backendHealth.payload?.rpc,
      telegram: backendHealth.payload?.telegram,
    };
  }

  if (invoiceHash && chatId) {
    const linked = await backendRequest('/v1/telegram/links', {
      method: 'POST',
      auth: true,
      body: {
        invoice_hash: invoiceHash,
        chat_id: String(chatId),
        creator_id: creatorId ? String(creatorId) : undefined,
      },
      expect: [201],
    });
    record('backend saves Telegram invoice link', linked.ok, summarize(linked));
    report.artifacts.linkWrite = linked.payload;

    const loaded = await backendRequest(`/v1/telegram/links/${encodeURIComponent(invoiceHash)}`, {
      auth: true,
      expect: [200],
    });
    record('backend reads Telegram invoice link', loaded.ok, summarize(loaded));
    report.artifacts.linkRead = loaded.payload;
  } else {
    skipOrFail('backend Telegram link persistence', 'set TELEGRAM_INVOICE_HASH/STAGING_INVOICE_HASH and TELEGRAM_CHAT_ID');
  }

  if (webhookSecret) {
    const hashForWebhook = invoiceHash || `0x${'1'.repeat(64)}`;
    const qantaraEvent = {
      id: `telegram_smoke_${Date.now()}`,
      type: 'message.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        invoice_hash: hashForWebhook,
        sender_label: 'Telegram smoke',
        message_preview: 'Signed webhook delivery check',
      },
    };
    const expectedStatuses = expectDelivery ? [200] : [200, 202];
    const delivered = await signedBotWebhook('/webhooks/qantara', webhookSecret, qantaraEvent, expectedStatuses);
    record('bot signed qantara webhook', delivered.ok, summarize(delivered));
    if (expectDelivery) record('bot qantara webhook delivered to Telegram', delivered.status === 200, summarize(delivered));
    report.artifacts.qantaraWebhook = delivered.payload;
  } else {
    skipOrFail('bot signed qantara webhook', 'set WEBHOOK_SECRET');
  }

  if (alertWebhookSecret) {
    const alertEvent = {
      id: `telegram_alert_smoke_${Date.now()}`,
      type: 'operational.alert',
      created: Math.floor(Date.now() / 1000),
      data: {
        alert: {
          id: 'telegram.smoke',
          severity: 'warning',
          message: 'Telegram alert smoke',
          value: 1,
          threshold: 1,
        },
      },
    };
    const expectedStatuses = expectDelivery ? [200] : [200, 503];
    const alert = await signedBotWebhook('/webhooks/alerts', alertWebhookSecret, alertEvent, expectedStatuses);
    record('bot signed alert webhook', alert.ok, summarize(alert));
    if (expectDelivery) record('bot alert webhook delivered to Telegram', alert.status === 200, summarize(alert));
    report.artifacts.alertWebhook = alert.payload;
  } else {
    skipOrFail('bot signed alert webhook', 'set ALERT_WEBHOOK_SECRET');
  }

  if (failures.length > 0) {
    console.error(`\nTelegram smoke failed: ${failures.join(', ')}`);
    writeReport();
    process.exit(1);
  }
  console.log(`\nTelegram smoke passed (${checks.length} checks).`);
  writeReport();
}

try {
  await main();
} finally {
  if (process.exitCode && reportPath) writeReport();
}
