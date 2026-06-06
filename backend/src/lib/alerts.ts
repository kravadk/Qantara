import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { sign } from './hmac.js';
import { optionalEnv } from './env.js';
import { rpcStatus } from './chain.js';
import { operationalStatus, type OperationalAlert } from './operations.js';
import * as store from './store.js';
import { logger } from './logger.js';

export interface AlertDispatchResult {
  enabled: boolean;
  processed: number;
  delivered: number;
  skipped: Array<{ id: string; reason: string }>;
  errors: Array<{ id: string; error: string }>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(optionalEnv(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldSend(alert: OperationalAlert, lastSentAt?: number): boolean {
  const minSeverity = optionalEnv('ALERT_MIN_SEVERITY') ?? 'critical';
  if (minSeverity === 'critical' && alert.severity !== 'critical') return false;
  const cooldown = numberEnv('ALERT_COOLDOWN_SECONDS', 300);
  return !lastSentAt || nowSeconds() - lastSentAt >= cooldown;
}

async function deliverAlert(alert: OperationalAlert, url: string, secret: string): Promise<number> {
  const created = nowSeconds();
  const body = JSON.stringify({
    id: `alert_${randomUUID()}`,
    type: 'operational.alert',
    created,
    data: {
      alert,
      backend: {
        version: '0.1.0',
        environment: process.env.NODE_ENV ?? 'development',
      },
    },
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Qantara-Signature': sign(secret, created, body),
      'X-Qantara-Timestamp': String(created),
      'X-Qantara-Event-Type': 'operational.alert',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

export async function dispatchOperationalAlerts(): Promise<AlertDispatchResult> {
  const url = optionalEnv('ALERT_WEBHOOK_URL');
  const secret = optionalEnv('ALERT_WEBHOOK_SECRET');
  if (!url || !secret) {
    return { enabled: false, processed: 0, delivered: 0, skipped: [], errors: [] };
  }

  const rpc = await rpcStatus();
  const status = operationalStatus({ rpc, contractAddress: optionalEnv('QANTARA_ADDRESS') });
  const result: AlertDispatchResult = { enabled: true, processed: 0, delivered: 0, skipped: [], errors: [] };
  for (const alert of status.alerts) {
    result.processed += 1;
    const existing = store.getOperationalAlertDelivery(alert.id);
    if (!shouldSend(alert, existing?.lastSentAt)) {
      result.skipped.push({ id: alert.id, reason: 'cooldown_or_severity' });
      continue;
    }
    try {
      const responseStatus = await deliverAlert(alert, url, secret);
      const ok = responseStatus >= 200 && responseStatus < 300;
      store.upsertOperationalAlertDelivery({
        alertId: alert.id,
        severity: alert.severity,
        status: responseStatus,
        attempts: (existing?.attempts ?? 0) + 1,
        lastValue: alert.value,
        lastThreshold: alert.threshold,
        lastError: ok ? undefined : `HTTP ${responseStatus}`,
        lastSentAt: nowSeconds(),
      });
      if (ok) {
        result.delivered += 1;
      } else {
        result.errors.push({ id: alert.id, error: `HTTP ${responseStatus}` });
      }
    } catch (err: any) {
      store.upsertOperationalAlertDelivery({
        alertId: alert.id,
        severity: alert.severity,
        status: 0,
        attempts: (existing?.attempts ?? 0) + 1,
        lastValue: alert.value,
        lastThreshold: alert.threshold,
        lastError: err?.message ?? 'alert_delivery_failed',
        lastSentAt: nowSeconds(),
      });
      result.errors.push({ id: alert.id, error: err?.message ?? 'alert_delivery_failed' });
    }
  }
  return result;
}

export function startOperationalAlertWorker(server: Server): void {
  if (optionalEnv('ALERT_WORKER_DISABLED') === 'true') return;
  if (!optionalEnv('ALERT_WEBHOOK_URL') || !optionalEnv('ALERT_WEBHOOK_SECRET')) return;
  const intervalMs = Math.max(15_000, Number(optionalEnv('ALERT_INTERVAL_MS') ?? '60000'));
  const timer = setInterval(() => {
    void dispatchOperationalAlerts().catch((err) => {
      logger.warn('alert_worker_failed', { message: err?.message ?? String(err) });
    });
  }, intervalMs);
  timer.unref();
  server.on('close', () => clearInterval(timer));
}
