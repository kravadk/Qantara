/**
 * HMAC-SHA256 signature for webhook payloads.
 *
 * Scheme (mirrors CheckoutApi.tsx docs):
 *   signature = hex(hmac_sha256(secret, `${timestamp}.${body}`))
 *
 * Verification:
 *   1. Recompute signature with stored secret
 *   2. Constant-time compare
 *   3. Reject if |now - timestamp| > 300 seconds (replay defense)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const FRESHNESS_SECONDS = 300;

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

export function verify(
  secret: string,
  receivedSignature: string,
  timestamp: number,
  body: string,
): { ok: true } | { ok: false; reason: string } {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > FRESHNESS_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const expected = sign(secret, timestamp, body);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(receivedSignature, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'length_mismatch' };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'invalid_hex' };
  }
  return { ok: true };
}
