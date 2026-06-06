/**
 * Qantara Backend entry point.
 */

import 'dotenv/config';
import { createApp } from './app.js';
import { startChainIndexer } from './lib/indexer.js';
import { startWebhookRetryWorker } from './lib/webhooks.js';
import { startOperationalAlertWorker } from './lib/alerts.js';
import { startReceiptAnchorWorker } from './lib/receiptAnchorWorker.js';
import { logger } from './lib/logger.js';
import { closeDatabase } from './lib/store.js';

const PORT = Number(process.env.PORT ?? 4000);
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Fail fast in production when required secrets are missing, instead of
// surfacing the failure lazily on the first request that needs them.
function validateProductionEnv(): void {
  if (NODE_ENV !== 'production') return;
  const required = ['API_KEY', 'WEBHOOK_SECRET', 'PAYMENT_INTENT_SECRET', 'SIWE_JWT_SECRET'];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    logger.error('startup_validation_failed', { missing });
    throw new Error(`Missing required production secrets: ${missing.join(', ')}`);
  }
}

validateProductionEnv();

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info('backend_listening', {
    port: PORT,
    env: NODE_ENV,
    corsOrigins: CORS_ORIGINS.length ? CORS_ORIGINS : 'not_configured',
    db: process.env.QANTARA_DB_PATH ?? 'data/qantara.sqlite',
    frontend: process.env.QANTARA_FRONTEND_URL ?? 'not_configured',
  });
});

startChainIndexer(server);
startWebhookRetryWorker(server);
startOperationalAlertWorker(server);
startReceiptAnchorWorker(server);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });

  // Force-exit if draining in-flight requests stalls.
  const forceTimer = setTimeout(() => {
    logger.error('shutdown_forced', { reason: 'drain_timeout' });
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  // server.close() stops accepting connections and fires 'close', which the
  // indexer / webhook / alert workers already listen on to clear their timers.
  server.close((err) => {
    if (err) logger.error('shutdown_server_close_error', { message: err.message });
    try {
      closeDatabase();
    } catch (dbErr) {
      logger.warn('shutdown_db_close_error', { message: (dbErr as Error)?.message });
    }
    clearTimeout(forceTimer);
    logger.info('shutdown_complete', { signal });
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
