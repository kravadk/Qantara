import { Router, type Request, type Response } from 'express';
import { optionalEnv } from '../lib/env.js';
import { type AuthIdentity, identityHasMerchantBoundary, validateBearerIdentity } from '../lib/authIdentity.js';
import { rpcStatus } from '../lib/chain.js';
import * as store from '../lib/store.js';
import { indexerRuntimeStatus } from '../lib/indexer.js';
import { indexerSafetySettings, operationalStatus } from '../lib/operations.js';
import { deploymentRegistryStatus } from '../lib/deployments.js';

const router = Router();

type SettingsLocals = {
  apiKeyIdentity: AuthIdentity;
};

async function requireApiKey(req: Request, res: Response<any, SettingsLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'ops:read') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!identityHasMerchantBoundary(identity)) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot access settings status',
    });
  }
  res.locals.apiKeyIdentity = identity;
  next();
}

function redactWebhookFailure(delivery: store.WebhookDelivery) {
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

router.get('/status', requireApiKey, async (_req, res) => {
  const rpc = await rpcStatus();
  const qantara = optionalEnv('QANTARA_ADDRESS') ?? null;
  const deploymentRegistry = deploymentRegistryStatus();
  const identity = res.locals.apiKeyIdentity;
  const merchant = identity.kind === 'stored' || identity.kind === 'session' ? identity.merchant : undefined;
  const invoiceTotal = merchant ? store.listInvoices({ merchant, limit: 1 }).total : store.size();
  const merchantInvoices = merchant ? store.listInvoices({ merchant, limit: 25 }).invoices : [];
  const auditLog = merchantInvoices
    .flatMap((invoice) => store.listEvents(invoice.hash, undefined, { limit: 5 }).map((event) => ({
      id: event.id,
      invoiceHash: event.invoiceHash,
      type: event.type,
      createdAt: event.createdAt,
    })))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  const webhookStats = store.webhookDeliveryStats({ merchant });
  const scopedWebhookFailures = webhookStats.recentFailures.map(redactWebhookFailure);
  const operational = operationalStatus({ rpc, contractAddress: qantara });
  const scopedOperational = {
    ...operational,
    alerts: operational.alerts.map((alert) => (
      alert.id === 'webhooks.retry_depth_high'
        ? { ...alert, value: webhookStats.dueRetries }
        : alert
    )),
    webhooks: {
      ...operational.webhooks,
      healthy: webhookStats.failed === 0 && webhookStats.dueRetries === 0,
      totalDeliveries: webhookStats.total,
      failedDeliveries: webhookStats.failed,
      dueRetries: webhookStats.dueRetries,
      pendingRetries: webhookStats.pendingRetries,
      maxAttempts: webhookStats.maxAttempts,
      lastFailureAt: webhookStats.lastFailureAt,
      recentFailures: scopedWebhookFailures,
    },
  };
  res.json({
    ok: true,
    backend: {
      db: 'ok',
      persistence: 'sqlite',
      invoices: invoiceTotal,
      migrations: store.migrationStatus(),
    },
    rpc,
    contracts: {
      qantara,
      qusdc: optionalEnv('QUSDC_ADDRESS') ?? null,
      registry: deploymentRegistry,
    },
    webhooks: {
      signingConfigured: !!optionalEnv('WEBHOOK_SECRET'),
      recentDeliveries: [],
      dueRetries: webhookStats.dueRetries,
      stats: {
        ...webhookStats,
        recentFailures: scopedWebhookFailures,
      },
    },
    telegram: {
      botTokenConfigured: !!optionalEnv('TELEGRAM_BOT_TOKEN') || !!optionalEnv('BOT_TOKEN'),
    },
    team: {
      mode: 'single_merchant_wallet',
      members: merchant ? [
        {
          address: merchant,
          role: 'owner',
          source: identity.kind === 'session' ? 'siwe_session' : 'merchant_api_key',
        },
      ] : [],
      roles: ['owner', 'developer', 'support', 'finance', 'viewer'],
      apiKeyScopes: [
        'invoices:read',
        'invoices:write',
        'webhooks:read',
        'webhooks:write',
        'notifications:read',
        'notifications:write',
        'receipts:read',
        'chain:read',
        'ops:read',
        'telegram:write',
      ],
      merchantWallets: merchant ? [merchant] : [],
      payoutWallet: optionalEnv('PAYOUT_WALLET_ADDRESS') ?? merchant ?? null,
      notificationRouting: {
        webhook: webhookStats.total > 0 ? 'active merchant webhook deliveries' : 'configure webhook endpoint per invoice/API',
        telegram: (!!optionalEnv('TELEGRAM_BOT_TOKEN') || !!optionalEnv('BOT_TOKEN')) ? 'bot configured; invoice links route messages' : 'bot token not configured',
        alerts: !!optionalEnv('ALERT_WEBHOOK_URL') && !!optionalEnv('ALERT_WEBHOOK_SECRET') ? 'operator alert webhook configured' : 'operator alert webhook not configured',
      },
      auditLog,
    },
    alerts: {
      webhookConfigured: !!optionalEnv('ALERT_WEBHOOK_URL') && !!optionalEnv('ALERT_WEBHOOK_SECRET'),
      minSeverity: optionalEnv('ALERT_MIN_SEVERITY') ?? 'critical',
      deliveries: [],
    },
    security: {
      envApiKeyConfigured: !!optionalEnv('API_KEY'),
      rpcVerification: true,
      unverifiedPaymentsAllowed: false,
    },
    indexer: {
      cursors: store.chainSyncStatus(qantara ?? undefined),
      runtime: indexerRuntimeStatus(),
      safety: indexerSafetySettings(),
    },
    operational: scopedOperational,
  });
});

export default router;
