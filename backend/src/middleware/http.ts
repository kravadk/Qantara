/**
 * Cross-cutting HTTP middleware: request context (correlation id + per-request
 * logger), request logging + metrics, a reusable rate limiter, and the
 * centralized 404 + error handlers.
 */

import type { Request, Response, NextFunction } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { logger, type Logger } from '../lib/logger.js';
import { optionalEnv } from '../lib/env.js';
import { incCounter, observeLatency } from '../lib/metrics.js';
import { captureException } from '../lib/errorTracking.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      startTime: number;
    }
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Low-cardinality route label for metrics (router mount path, not the full URL). */
function routeLabel(req: Request): string {
  return req.baseUrl || (req.path === '/' ? '/' : req.path) || 'unknown';
}

/** Assigns a correlation id + child logger, then logs/records the response. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
  req.id = id;
  req.startTime = Date.now();
  req.log = logger.child({ requestId: id });
  res.setHeader('X-Request-Id', id);

  res.on('finish', () => {
    const durationMs = Date.now() - req.startTime;
    const route = routeLabel(req);
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    incCounter('qantara_http_requests_total', { method: req.method, route, status: statusClass });
    observeLatency('qantara_http_request_duration_seconds', durationMs, { method: req.method, route });
    if (res.statusCode >= 500) {
      incCounter('qantara_http_errors_total', { route });
    }
    // Health/metrics probes are noisy; keep them at debug.
    const level = req.path === '/health' || req.path === '/v1/health' || req.path === '/metrics' || req.path === '/v1/metrics'
      ? 'debug'
      : res.statusCode >= 500
        ? 'error'
        : 'info';
    req.log[level]('request', { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs });
  });

  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // HSTS is honoured by browsers only over HTTPS and ignored over plain HTTP, so
  // it is safe to always set; it hardens the API once served behind TLS.
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy-Report-Only', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "frame-src https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
}

/**
 * Rate-limit key that isolates by credential when present, falling back to IP.
 * A bearer token (SIWE session or API key) is hashed so different merchants /
 * credentials get independent buckets instead of sharing one per-IP bucket
 * (important once onboarding is public and many merchants share an egress IP).
 */
export function authOrIpKey(req: Request): string {
  const auth = req.header('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (m) return `cred:${createHash('sha256').update(m[1]).digest('hex').slice(0, 32)}`;
  return `ip:${clientIp(req)}`;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  key?: (req: Request) => string;
}

/**
 * Process-level leaky-bucket rate limiter. Disabled entirely when
 * RATE_LIMIT_DISABLED=true (used by the integration test suite).
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 60;
  const keyFn = options.key ?? clientIp;
  const buckets = new Map<string, number[]>();
  const disabled = optionalEnv('RATE_LIMIT_DISABLED') === 'true';

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    if (disabled) return next();
    const key = keyFn(req);
    const now = Date.now();
    const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: 'rate_limit' });
      return;
    }
    hits.push(now);
    buckets.set(key, hits);
    next();
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

/** Terminal error handler — must be registered last. Never leaks stack traces. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Malformed JSON body (express.json throws a SyntaxError with .status 400).
  const status = typeof (err as { status?: number })?.status === 'number'
    ? (err as { status: number }).status
    : (err as { statusCode?: number })?.statusCode ?? 500;
  const isBadJson = err instanceof SyntaxError && status === 400;
  const log = req.log ?? logger;
  if (status >= 500) {
    log.error('unhandled_error', {
      message: (err as Error)?.message,
      stack: (err as Error)?.stack,
      path: req.originalUrl,
    });
    captureException(err, {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status,
    });
  }
  if (res.headersSent) return;
  if (isBadJson) {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status >= 500 ? 'internal_error' : 'request_error',
  });
}
