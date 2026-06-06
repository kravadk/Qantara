import { optionalEnv } from './env.js';
import { logger } from './logger.js';

let reportedDisabled = false;

export function errorTrackingStatus() {
  const dsn = optionalEnv('ERROR_TRACKING_DSN') ?? optionalEnv('SENTRY_DSN');
  return {
    enabled: Boolean(dsn),
    provider: dsn ? 'env_dsn' : 'noop',
  };
}

export function captureException(error: unknown, context: Record<string, unknown> = {}): void {
  const dsn = optionalEnv('ERROR_TRACKING_DSN') ?? optionalEnv('SENTRY_DSN');
  const message = error instanceof Error ? error.message : String(error);

  if (!dsn) {
    if (!reportedDisabled) {
      reportedDisabled = true;
      logger.info('error_tracking_disabled', { provider: 'noop' });
    }
    return;
  }

  logger.error('error_tracking_event', {
    provider: 'env_dsn',
    message,
    ...context,
  });

  if (!/^https?:\/\//i.test(dsn)) return;
  const body = JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    context,
  });
  fetch(dsn, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }).catch((err) => {
    logger.warn('error_tracking_delivery_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  });
}
