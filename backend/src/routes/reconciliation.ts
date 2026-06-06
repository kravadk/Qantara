import { Router } from 'express';
import { optionalEnv } from '../lib/env.js';
import { rpcStatus } from '../lib/chain.js';
import * as store from '../lib/store.js';
import { deploymentRegistryStatus } from '../lib/deployments.js';
import { indexerRuntimeStatus } from '../lib/indexer.js';
import { indexerSafetySettings, operationalStatus } from '../lib/operations.js';

const router = Router();

const INVOICE_STATUS_LABELS: Array<[string, store.InvoiceStatusValue]> = [
  ['open', store.InvoiceStatus.Created],
  ['paid', store.InvoiceStatus.Paid],
  ['cancelled', store.InvoiceStatus.Cancelled],
  ['refunded', store.InvoiceStatus.Refunded],
  ['paused', store.InvoiceStatus.Paused],
];

const REDACTED_PAYLOAD_KEY = /(secret|api[_-]?key|authorization|bearer|guest[_-]?token|webhook|delivery|internal|target[_-]?url|payload)/i;

function redactPayload(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (REDACTED_PAYLOAD_KEY.test(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = redactPayload(value as Record<string, unknown>);
      if (Object.keys(nested).length > 0) clean[key] = nested;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function invoiceCountsByStatus() {
  return INVOICE_STATUS_LABELS.reduce<Record<string, number>>((acc, [label, status]) => {
    acc[label] = store.listInvoices({ status, limit: 1 }).total;
    return acc;
  }, {});
}

function publicWebhookFailure(delivery: store.WebhookDelivery) {
  return {
    id: delivery.id,
    invoiceHash: delivery.invoiceHash,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    lastError: delivery.lastError,
    nextRetryAt: delivery.nextRetryAt,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

function publicChainEvent(event: store.ChainEvent) {
  return {
    id: event.id,
    contractAddress: event.contractAddress,
    invoiceHash: event.invoiceHash,
    eventType: event.eventType,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    logIndex: event.logIndex,
    payload: redactPayload(event.payload),
    createdAt: event.createdAt,
  };
}

function publicFailureEvent(event: store.InvoiceEvent) {
  return {
    id: event.id,
    invoiceHash: event.invoiceHash,
    type: event.type,
    payload: redactPayload(event.payload),
    createdAt: event.createdAt,
  };
}

function publicRpcStatus(rpc: Awaited<ReturnType<typeof rpcStatus>>) {
  return {
    ok: rpc.ok === true,
    url: rpc.url,
    chainId: rpc.chainId,
    blockNumber: rpc.blockNumber,
    error: rpc.ok === true ? undefined : 'rpc_unavailable',
  };
}

router.get('/status', async (_req, res) => {
  const qantaraAddress = optionalEnv('QANTARA_ADDRESS') ?? undefined;
  const rpc = await rpcStatus();
  const publicRpc = publicRpcStatus(rpc);
  const webhookStats = store.webhookDeliveryStats();
  const now = Math.floor(Date.now() / 1000);
  const rpcFailureCount24h = store.countEventsByType('payment.verification_failed', now - 24 * 60 * 60);
  const operational = operationalStatus({ rpc, contractAddress: qantaraAddress });
  const receiptResult = store.listReceipts({ limit: 1 });
  const recentChainEvents = store.listChainEvents({ limit: 10 }).map(publicChainEvent);
  const deploymentRegistry = deploymentRegistryStatus();
  const byStatus = invoiceCountsByStatus();
  const missingForPaid = Math.max(0, byStatus.paid - receiptResult.total);

  res.json({
    ok: true,
    source: 'sqlite',
    generatedAt: now,
    db: {
      persistence: 'sqlite',
      status: 'ok',
      migrations: store.migrationStatus(),
    },
    invoices: {
      total: store.size(),
      byStatus,
    },
    receipts: {
      total: receiptResult.total,
      issued: receiptResult.total,
      missingForPaid,
      pending: missingForPaid,
    },
    chain: {
      contractAddress: qantaraAddress ?? null,
      rpc: publicRpc,
      indexer: {
        configured: operational.indexer.configured,
        healthy: operational.indexer.healthy,
        contractAddress: operational.indexer.contractAddress,
        rpcBlockNumber: operational.indexer.rpcBlockNumber,
        cursorBlock: operational.indexer.cursorBlock,
        lagBlocks: operational.indexer.lagBlocks,
        cursorStaleSeconds: operational.indexer.cursorStaleSeconds,
        cursors: store.chainSyncStatus(qantaraAddress),
        runtime: indexerRuntimeStatus(),
        safety: indexerSafetySettings(),
      },
      events: {
        total: store.countChainEvents(),
        recentCount: recentChainEvents.length,
        recent: recentChainEvents,
      },
    },
    webhooks: {
      totalDeliveries: webhookStats.total,
      failedDeliveries: webhookStats.failed,
      dueRetries: webhookStats.dueRetries,
      pendingRetries: webhookStats.pendingRetries,
      maxAttempts: webhookStats.maxAttempts,
      lastFailureAt: webhookStats.lastFailureAt,
      recentFailures: webhookStats.recentFailures.map(publicWebhookFailure),
    },
    rpcVerification: {
      failures24h: rpcFailureCount24h,
      recentFailures: store.listEventsByType('payment.verification_failed', { limit: 5 }).map(publicFailureEvent),
    },
    deployments: {
      ok: deploymentRegistry.ok,
      network: deploymentRegistry.network,
      chainId: deploymentRegistry.chainId,
      release: deploymentRegistry.release,
      verifiedAt: deploymentRegistry.verifiedAt,
      requiredConfigured: deploymentRegistry.requiredConfigured,
      contracts: deploymentRegistry.contracts.map((contract) => ({
        key: contract.key,
        label: contract.label,
        role: contract.role,
        required: contract.required,
        address: contract.configuredAddress,
        status: contract.status,
        verified: contract.verified,
      })),
    },
    operational: {
      ok: operational.ok,
      alerts: operational.alerts,
      thresholds: operational.thresholds,
      indexer: operational.indexer,
      webhooks: {
        ...operational.webhooks,
        recentFailures: operational.webhooks.recentFailures.map(publicWebhookFailure),
      },
      rpcVerification: {
        healthy: operational.rpcVerification.healthy,
        failures24h: operational.rpcVerification.failures24h,
        recentFailures: operational.rpcVerification.recentFailures.map(publicFailureEvent),
      },
    },
  });
});

export default router;
