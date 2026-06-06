import type { Address } from 'viem';
import { optionalEnv } from './env.js';
import * as store from './store.js';

export interface RpcSnapshot {
  ok?: boolean;
  blockNumber?: number;
}

export interface OperationalAlert {
  id: string;
  severity: 'warning' | 'critical';
  message: string;
  value?: number;
  threshold?: number;
}

function positiveNumberEnv(name: string, fallback: number): number {
  const parsed = Number(optionalEnv(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const parsed = Number(optionalEnv(name));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

export function indexerSafetySettings() {
  return {
    confirmations: nonNegativeNumberEnv('CHAIN_CONFIRMATIONS', 0),
    reorgRollbackBlocks: positiveNumberEnv('CHAIN_REORG_ROLLBACK_BLOCKS', 12),
  };
}

export function operationalStatus(input: {
  rpc: RpcSnapshot;
  contractAddress?: Address | string | null;
}) {
  const now = Math.floor(Date.now() / 1000);
  const maxIndexerLagBlocks = positiveNumberEnv('INDEXER_MAX_LAG_BLOCKS', 50);
  const indexerStaleAfterSeconds = positiveNumberEnv('INDEXER_STALE_AFTER_SECONDS', 120);
  const maxDueWebhookRetries = nonNegativeNumberEnv('WEBHOOK_MAX_DUE_RETRIES', 0);
  const maxRpcVerificationFailures24h = nonNegativeNumberEnv('RPC_VERIFY_MAX_FAILURES_24H', 0);
  const safety = indexerSafetySettings();

  const cursor = input.contractAddress
    ? store.chainSyncStatus(input.contractAddress)[0]
    : undefined;
  const lagBlocks = input.rpc.ok && typeof input.rpc.blockNumber === 'number' && cursor
    ? Math.max(0, input.rpc.blockNumber - cursor.lastBlock)
    : undefined;
  const cursorStaleSeconds = cursor?.updatedAt ? Math.max(0, now - cursor.updatedAt) : undefined;
  const indexerConfigured = !!input.contractAddress;
  const indexerHealthy = !indexerConfigured
    ? false
    : !!cursor &&
      lagBlocks !== undefined &&
      lagBlocks <= maxIndexerLagBlocks &&
      cursorStaleSeconds !== undefined &&
      cursorStaleSeconds <= indexerStaleAfterSeconds;

  const webhooks = store.webhookDeliveryStats();
  const webhookHealthy = webhooks.dueRetries <= maxDueWebhookRetries;

  const since24h = now - 24 * 60 * 60;
  const rpcVerificationFailures24h = store.countEventsByType('payment.verification_failed', since24h);
  const rpcVerificationHealthy = rpcVerificationFailures24h <= maxRpcVerificationFailures24h;
  const alerts: OperationalAlert[] = [];
  if (indexerConfigured && !cursor) {
    alerts.push({
      id: 'indexer.cursor_missing',
      severity: 'warning',
      message: 'Chain indexer is configured but no cursor has been recorded yet.',
    });
  }
  if (lagBlocks !== undefined && lagBlocks > maxIndexerLagBlocks) {
    alerts.push({
      id: 'indexer.lag_high',
      severity: lagBlocks > maxIndexerLagBlocks * 5 ? 'critical' : 'warning',
      message: 'Chain indexer is behind the current RPC block.',
      value: lagBlocks,
      threshold: maxIndexerLagBlocks,
    });
  }
  if (cursorStaleSeconds !== undefined && cursorStaleSeconds > indexerStaleAfterSeconds) {
    alerts.push({
      id: 'indexer.cursor_stale',
      severity: cursorStaleSeconds > indexerStaleAfterSeconds * 5 ? 'critical' : 'warning',
      message: 'Chain indexer cursor has not been updated recently.',
      value: cursorStaleSeconds,
      threshold: indexerStaleAfterSeconds,
    });
  }
  if (webhooks.dueRetries > maxDueWebhookRetries) {
    alerts.push({
      id: 'webhooks.retry_depth_high',
      severity: webhooks.dueRetries > Math.max(5, maxDueWebhookRetries * 5) ? 'critical' : 'warning',
      message: 'Webhook retry queue has due deliveries.',
      value: webhooks.dueRetries,
      threshold: maxDueWebhookRetries,
    });
  }
  if (rpcVerificationFailures24h > maxRpcVerificationFailures24h) {
    alerts.push({
      id: 'rpc.verification_failures_high',
      severity: rpcVerificationFailures24h > Math.max(10, maxRpcVerificationFailures24h * 5) ? 'critical' : 'warning',
      message: 'RPC payment verification failures exceeded the configured threshold.',
      value: rpcVerificationFailures24h,
      threshold: maxRpcVerificationFailures24h,
    });
  }

  return {
    ok: indexerHealthy && webhookHealthy && rpcVerificationHealthy,
    alerts,
    thresholds: {
      maxIndexerLagBlocks,
      indexerStaleAfterSeconds,
      maxDueWebhookRetries,
      maxRpcVerificationFailures24h,
      ...safety,
    },
    indexer: {
      configured: indexerConfigured,
      healthy: indexerHealthy,
      contractAddress: input.contractAddress ?? null,
      rpcBlockNumber: input.rpc.blockNumber,
      cursorBlock: cursor?.lastBlock,
      cursorBlockHash: cursor?.lastBlockHash ?? null,
      cursorParentHash: cursor?.lastParentHash ?? null,
      cursorAnchored: !!cursor?.lastBlockHash,
      lagBlocks,
      cursorUpdatedAt: cursor?.updatedAt,
      cursorStaleSeconds,
      safety,
    },
    webhooks: {
      healthy: webhookHealthy,
      totalDeliveries: webhooks.total,
      failedDeliveries: webhooks.failed,
      dueRetries: webhooks.dueRetries,
      pendingRetries: webhooks.pendingRetries,
      maxAttempts: webhooks.maxAttempts,
      lastFailureAt: webhooks.lastFailureAt,
      recentFailures: webhooks.recentFailures,
    },
    rpcVerification: {
      healthy: rpcVerificationHealthy,
      failures24h: rpcVerificationFailures24h,
      recentFailures: store.listEventsByType('payment.verification_failed', { limit: 5 }),
    },
  };
}

function metric(name: string, help: string, value: number, labels: Record<string, string | number | boolean | undefined> = {}): string {
  const labelEntries = Object.entries(labels).filter(([, labelValue]) => labelValue !== undefined);
  const encodedLabels = labelEntries.length
    ? `{${labelEntries.map(([key, labelValue]) => `${key}="${String(labelValue).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
    : '';
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}${encodedLabels} ${Number.isFinite(value) ? value : 0}`,
  ].join('\n');
}

export function operationalMetricsText(input: {
  rpc: RpcSnapshot;
  contractAddress?: Address | string | null;
  uptimeSeconds: number;
  invoiceCount: number;
}): string {
  const status = operationalStatus(input);
  const lines = [
    metric('qantara_backend_up', 'Backend process health.', 1),
    metric('qantara_backend_uptime_seconds', 'Backend process uptime in seconds.', input.uptimeSeconds),
    metric('qantara_invoices_total', 'Total invoices in the backend application index.', input.invoiceCount),
    metric('qantara_operational_healthy', 'Overall operational health from indexer, webhooks, and RPC verification.', status.ok ? 1 : 0),
    metric('qantara_rpc_up', 'QIE RPC health.', input.rpc.ok ? 1 : 0),
    metric('qantara_rpc_block_number', 'Latest block number observed from QIE RPC.', input.rpc.blockNumber ?? 0),
    metric('qantara_indexer_healthy', 'Chain indexer health.', status.indexer.healthy ? 1 : 0),
    metric('qantara_indexer_lag_blocks', 'Chain indexer lag behind the QIE RPC block.', status.indexer.lagBlocks ?? 0),
    metric('qantara_indexer_cursor_stale_seconds', 'Age of the chain indexer cursor.', status.indexer.cursorStaleSeconds ?? 0),
    metric('qantara_indexer_cursor_anchored', 'Whether the chain indexer cursor has canonical block-hash metadata.', status.indexer.cursorAnchored ? 1 : 0),
    metric('qantara_indexer_confirmations', 'Configured chain confirmation depth before events are indexed.', status.indexer.safety.confirmations),
    metric('qantara_indexer_reorg_rollback_blocks', 'Configured block rollback window when a cursor re-org is detected.', status.indexer.safety.reorgRollbackBlocks),
    metric('qantara_webhook_due_retries', 'Webhook deliveries due for retry.', status.webhooks.dueRetries),
    metric('qantara_webhook_failed_deliveries', 'Webhook deliveries with non-2xx status.', status.webhooks.failedDeliveries),
    metric('qantara_webhook_pending_retries', 'Webhook deliveries with a scheduled retry.', status.webhooks.pendingRetries),
    metric('qantara_webhook_max_attempts', 'Maximum attempts observed on webhook deliveries.', status.webhooks.maxAttempts),
    metric('qantara_rpc_verification_failures_24h', 'Payment verification failures recorded in the last 24 hours.', status.rpcVerification.failures24h),
    metric('qantara_operational_alerts', 'Current operational alert count.', status.alerts.length),
    ...status.alerts.map((alert) =>
      metric('qantara_operational_alert_active', 'Active operational alert by id and severity.', 1, {
        id: alert.id,
        severity: alert.severity,
      }),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
