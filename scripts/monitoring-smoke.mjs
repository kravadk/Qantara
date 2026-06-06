#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const backendUrl = cleanUrl(
  process.env.BACKEND_URL
  || process.env.QANTARA_BACKEND_URL
  || process.env.VITE_QANTARA_BACKEND_URL,
);
const apiKey = process.env.API_KEY || process.env.QANTARA_API_KEY;
const expectDelivery = process.env.MONITORING_EXPECT_DELIVERY === 'true';
const reportPath = process.env.MONITORING_REPORT_PATH
  ? resolve(process.env.MONITORING_REPORT_PATH)
  : undefined;

const checks = [];
const failures = [];
const report = {
  startedAt: new Date().toISOString(),
  backendUrl,
  expectDelivery,
  checks,
  artifacts: {},
};

function cleanUrl(value) {
  return value?.trim().replace(/\/$/, '');
}

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'OK ' : 'ERR'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

function requireValue(name, value) {
  if (!value) {
    record(`env:${name}`, false, 'required for monitoring smoke');
    return false;
  }
  record(`env:${name}`, true);
  return true;
}

async function request(path, { method = 'GET', auth = false, body, text = false, expect = [200] } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${apiKey}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${backendUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = text ? await res.text() : await res.json().catch(() => ({}));
  return { ok: expect.includes(res.status), status: res.status, payload };
}

async function checkRequest(name, path, options) {
  try {
    const result = await request(path, options);
    const summary = typeof result.payload === 'string'
      ? result.payload.replace(/\s+/g, ' ').slice(0, 180)
      : JSON.stringify(result.payload).slice(0, 220);
    record(name, result.ok, `HTTP ${result.status}${summary ? ` ${summary}` : ''}`);
    return result;
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
    return { ok: false, status: 0, payload: null };
  }
}

function metricValue(metrics, name) {
  const match = metrics.match(new RegExp(`^${name}(?:\\{[^\\n]*\\})?\\s+(-?\\d+(?:\\.\\d+)?)$`, 'm'));
  return match ? Number(match[1]) : undefined;
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
  const hasBackend = requireValue('BACKEND_URL/QANTARA_BACKEND_URL', backendUrl);
  const hasApiKey = requireValue('API_KEY/QANTARA_API_KEY', apiKey);
  if (!hasBackend || !hasApiKey) {
    process.exitCode = 2;
    return;
  }

  const metrics = await checkRequest('metrics', '/v1/metrics', { text: true });
  if (metrics.ok && typeof metrics.payload === 'string') {
    const backendUp = metricValue(metrics.payload, 'qantara_backend_up');
    const rpcUp = metricValue(metrics.payload, 'qantara_rpc_up');
    const alertCount = metricValue(metrics.payload, 'qantara_operational_alerts');
    record('metrics backend up', backendUp === 1, `value=${backendUp ?? 'missing'}`);
    record('metrics rpc up', rpcUp === 1, `value=${rpcUp ?? 'missing'}`);
    record('metrics alert count exported', alertCount !== undefined, `value=${alertCount ?? 'missing'}`);
    report.artifacts.metrics = {
      backendUp,
      rpcUp,
      alertCount,
      webhookDueRetries: metricValue(metrics.payload, 'qantara_webhook_due_retries'),
      rpcVerificationFailures24h: metricValue(metrics.payload, 'qantara_rpc_verification_failures_24h'),
    };
  }

  const settings = await checkRequest('settings status', '/v1/settings/status', { auth: true });
  if (settings.ok) {
    const configured = settings.payload?.alerts?.webhookConfigured === true;
    record('alert webhook configured', configured, JSON.stringify(settings.payload?.alerts ?? {}));
    report.artifacts.settingsAlerts = settings.payload?.alerts;
  }

  const before = await checkRequest('alert deliveries before dispatch', '/v1/alerts/deliveries', { auth: true });
  const beforeAttempts = new Map();
  if (before.ok && Array.isArray(before.payload?.deliveries)) {
    for (const delivery of before.payload.deliveries) {
      beforeAttempts.set(delivery.alertId, Number(delivery.attempts ?? 0));
    }
    report.artifacts.deliveriesBefore = before.payload.deliveries.map((delivery) => ({
      alertId: delivery.alertId,
      severity: delivery.severity,
      status: delivery.status,
      attempts: delivery.attempts,
      lastError: delivery.lastError,
      updatedAt: delivery.updatedAt,
    }));
  }

  const dispatched = await checkRequest('alert dispatch', '/v1/alerts/dispatch', {
    method: 'POST',
    auth: true,
  });
  if (dispatched.ok) {
    const payload = dispatched.payload ?? {};
    record('alert dispatch enabled', payload.enabled === true, JSON.stringify({ enabled: payload.enabled }));
    record('alert dispatch processed count valid', Number.isInteger(payload.processed) && payload.processed >= 0, `processed=${payload.processed}`);
    record('alert dispatch delivered count valid', Number.isInteger(payload.delivered) && payload.delivered >= 0, `delivered=${payload.delivered}`);
    if (payload.errors?.length) {
      record('alert dispatch has no delivery errors', false, JSON.stringify(payload.errors).slice(0, 240));
    } else {
      record('alert dispatch has no delivery errors', true);
    }
    if (expectDelivery) {
      record('alert dispatch delivered at least one alert', payload.delivered > 0, `delivered=${payload.delivered}`);
    }
    report.artifacts.dispatch = payload;
  }

  const after = await checkRequest('alert deliveries after dispatch', '/v1/alerts/deliveries', { auth: true });
  if (after.ok && Array.isArray(after.payload?.deliveries)) {
    const deliveries = after.payload.deliveries;
    report.artifacts.deliveriesAfter = deliveries.map((delivery) => ({
      alertId: delivery.alertId,
      severity: delivery.severity,
      status: delivery.status,
      attempts: delivery.attempts,
      lastError: delivery.lastError,
      updatedAt: delivery.updatedAt,
    }));
    const changed = deliveries.filter((delivery) => Number(delivery.attempts ?? 0) > (beforeAttempts.get(delivery.alertId) ?? 0));
    if (expectDelivery) {
      record('alert delivery log has new attempt', changed.length > 0, `changed=${changed.map((d) => d.alertId).join(',') || 'none'}`);
      record(
        'alert delivery log has successful new attempt',
        changed.some((delivery) => Number(delivery.status) >= 200 && Number(delivery.status) < 300),
        `statuses=${changed.map((d) => `${d.alertId}:${d.status}`).join(',') || 'none'}`,
      );
    } else {
      record('alert delivery log readable', true, `deliveries=${deliveries.length}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nMonitoring smoke failed: ${failures.join(', ')}`);
    writeReport();
    process.exit(1);
  }
  console.log(`\nMonitoring smoke passed (${checks.length} checks).`);
  writeReport();
}

try {
  await main();
} finally {
  if (process.exitCode && reportPath) writeReport();
}
