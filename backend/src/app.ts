import express from 'express';
import cors from 'cors';
import checkoutRouter from './routes/checkout.js';
import invoicesRouter from './routes/invoices.js';
import resolveRouter from './routes/resolve.js';
import authRouter from './routes/auth.js';
import relayRouter from './routes/relay.js';
import copilotRouter from './routes/copilot.js';
import onrampRouter from './routes/onramp.js';
import receiptsRouter from './routes/receipts.js';
import webhooksRouter from './routes/webhooks.js';
import apiKeysRouter from './routes/apiKeys.js';
import chainRouter from './routes/chain.js';
import settingsRouter from './routes/settings.js';
import alertsRouter from './routes/alerts.js';
import deploymentsRouter from './routes/deployments.js';
import telegramRouter from './routes/telegram.js';
import notificationsRouter from './routes/notifications.js';
import railsRouter from './routes/rails.js';
import explorerRouter from './routes/explorer.js';
import paymentRequirementsRouter from './routes/paymentRequirements.js';
import paymentRoutesRouter from './routes/paymentRoutes.js';
import reconciliationRouter from './routes/reconciliation.js';
import billingRouter from './routes/billing.js';
import merchantsRouter from './routes/merchants.js';
import qieRouter from './routes/qie.js';
import { openApiSpec } from './lib/openapi.js';
import * as store from './lib/store.js';
import { rpcStatus } from './lib/chain.js';
import { indexerRuntimeStatus } from './lib/indexer.js';
import { indexerSafetySettings, operationalMetricsText, operationalStatus } from './lib/operations.js';
import paymentIntentsRouter from './routes/paymentIntents.js';
import { requestContext, rateLimit, authOrIpKey, securityHeaders, notFoundHandler, errorHandler } from './middleware/http.js';
import { renderRequestMetrics } from './lib/metrics.js';
import { optionalEnv } from './lib/env.js';
import { errorTrackingStatus } from './lib/errorTracking.js';

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(requestContext);
  app.use(securityHeaders);

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: ${origin} not allowed`));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '64kb' }));

  app.use('/v1/checkout', rateLimit({ max: Number(optionalEnv('RATE_LIMIT_CHECKOUT_PER_MIN') ?? '120') }), checkoutRouter);
  app.use('/v1/invoices', rateLimit({ max: Number(optionalEnv('RATE_LIMIT_INVOICES_PER_MIN') ?? '240'), key: authOrIpKey }), invoicesRouter);
  app.use('/v1/resolve', resolveRouter);
  app.use('/v1/auth', rateLimit({ max: Number(optionalEnv('RATE_LIMIT_AUTH_PER_MIN') ?? '60') }), authRouter);
  app.use('/v1/relay', relayRouter);
  app.use('/v1/copilot', copilotRouter);
  app.use('/v1/onramp', onrampRouter);
  app.use('/v1/receipts', receiptsRouter);
  app.use('/v1/webhooks', webhooksRouter);
  app.use('/v1/api-keys', rateLimit({ max: Number(optionalEnv('RATE_LIMIT_API_KEYS_PER_MIN') ?? '60'), key: authOrIpKey }), apiKeysRouter);
  app.use('/v1/chain', chainRouter);
  app.use('/v1/settings', settingsRouter);
  app.use('/v1/alerts', alertsRouter);
  app.use('/v1/deployments', deploymentsRouter);
  app.use('/v1/telegram', telegramRouter);
  app.use('/v1/payment-intents', paymentIntentsRouter);
  app.use('/v1/notifications', notificationsRouter);
  app.use('/v1/rails', railsRouter);
  app.use('/v1/explorer', explorerRouter);
  app.use('/v1/payment-requirements', paymentRequirementsRouter);
  app.use('/v1/payment-routes', paymentRoutesRouter);
  app.use('/v1/reconciliation', reconciliationRouter);
  app.use('/v1/billing', billingRouter);
  app.use('/v1/merchants', merchantsRouter);
  app.use('/v1/qie', qieRouter);

  app.get('/v1/openapi.json', (_req, res) => {
    res.json(openApiSpec('1.0.0-rc.1'));
  });

  const healthHandler = async (_req: express.Request, res: express.Response) => {
    const rpc = await rpcStatus();
    const contractAddress = process.env.QANTARA_ADDRESS;
    res.json({
      ok: true,
      status: 'ok',
      env: NODE_ENV,
      uptime_seconds: Math.floor(process.uptime()),
      invoices: store.size(),
      persistence: 'sqlite',
      db: 'ok',
      migrations: store.migrationStatus(),
      rpc,
      indexer: {
        configured: !!contractAddress,
        cursors: store.chainSyncStatus(contractAddress),
        runtime: indexerRuntimeStatus(),
        safety: indexerSafetySettings(),
      },
      operational: operationalStatus({ rpc, contractAddress }),
      version: '1.0.0-rc.1',
    });
  };

  app.get('/health', healthHandler);
  app.get('/v1/health', healthHandler);

  const readyHandler = async (_req: express.Request, res: express.Response) => {
    const migrations = store.migrationStatus();
    const rpc = await rpcStatus();
    const migrationsApplied = !!migrations && typeof migrations.current === 'string' && migrations.current.length > 0;
    const ready = migrationsApplied && rpc.ok === true;
    res.status(ready ? 200 : 503).json({
      ready,
      db: migrationsApplied ? 'ok' : 'pending',
      migration: migrations?.current ?? null,
      rpc: rpc.ok === true,
    });
  };

  app.get('/ready', readyHandler);
  app.get('/v1/ready', readyHandler);

  const statusHandler = async (_req: express.Request, res: express.Response) => {
    const rpc = await rpcStatus();
    const contractAddress = process.env.QANTARA_ADDRESS;
    const operational = operationalStatus({ rpc, contractAddress });
    res.json({
      ok: true,
      status: operational.ok ? 'ok' : 'degraded',
      version: '1.0.0-rc.1',
      uptime_seconds: Math.floor(process.uptime()),
      db: 'ok',
      rpc: {
        ok: rpc.ok === true,
        blockNumber: rpc.blockNumber ?? null,
      },
      indexer: {
        configured: !!contractAddress,
        runtime: indexerRuntimeStatus(),
      },
      operational: {
        healthy: operational.ok,
        alerts: operational.alerts.length,
      },
      errorTracking: errorTrackingStatus(),
    });
  };

  app.get('/status', statusHandler);
  app.get('/v1/status', statusHandler);

  const metricsHandler = async (_req: express.Request, res: express.Response) => {
    const rpc = await rpcStatus();
    const operational = operationalMetricsText({
      rpc,
      contractAddress: process.env.QANTARA_ADDRESS,
      uptimeSeconds: Math.floor(process.uptime()),
      invoiceCount: store.size(),
    });
    res.type('text/plain; version=0.0.4; charset=utf-8').send(`${operational}${renderRequestMetrics()}`);
  };

  app.get('/metrics', metricsHandler);
  app.get('/v1/metrics', metricsHandler);

  app.get('/', (_req, res) => {
    res.json({
      name: 'Qantara Backend',
      version: '1.0.0-rc.1',
      docs: 'https://qantara.app/app/checkout-api',
      endpoints: [
        'POST /v1/checkout/sessions',
        'GET  /v1/checkout/sessions/:id',
        'GET  /v1/invoices/:hash',
        'GET  /v1/invoices?merchant=...',
        'POST /v1/invoices/:hash/verify-payment',
        'POST /v1/invoices/:hash/refund/verify',
        'POST /v1/invoices/:hash/refund/verify-contract',
        'POST /v1/invoices/:hash/cancel/verify',
        'POST /v1/invoices/:hash/pause/verify',
        'POST /v1/invoices/:hash/resume/verify',
        'GET  /v1/invoices/:hash/messages',
        'POST /v1/invoices/:hash/messages',
        'POST /v1/invoices/:hash/messages/:id/read',
        'GET  /v1/invoices/:hash/events',
        'GET  /v1/receipts/status',
        'GET  /v1/receipts/:hash',
        'GET  /v1/webhooks/deliveries',
        'POST /v1/webhooks/deliveries/:id/retry',
        'POST /v1/webhooks/retry-due',
        'POST /v1/webhooks/test',
        'GET  /v1/chain/status',
        'POST /v1/chain/sync',
        'GET  /v1/settings/status',
        'GET  /v1/notifications',
        'GET  /v1/deployments/status',
        'GET  /v1/rails',
        'GET  /v1/rails/status',
        'GET  /v1/explorer/activity',
        'GET  /v1/payment-requirements/:hash',
        'GET  /v1/payment-routes/:hash',
        'GET  /v1/reconciliation/status',
        'GET  /v1/qie/network-catalog',
        'GET  /v1/qie/ecosystem',
        'GET  /v1/qie/lending/status',
        'GET  /v1/telegram/links',
        'POST /v1/telegram/links',
        'GET  /v1/metrics',
        'GET  /v1/alerts/deliveries',
        'POST /v1/alerts/dispatch',
        'GET  /v1/api-keys',
        'POST /v1/payment-intents',
        'GET  /v1/resolve?q=<handle>',
        'GET  /v1/auth/nonce',
        'POST /v1/auth/verify',
        'GET  /v1/auth/me',
        'GET  /v1/relay/status',
        'GET  /v1/relay/recent',
        'POST /v1/relay/sponsor',
        'POST /v1/copilot',
        'GET  /health',
        'GET  /metrics',
      ],
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
