import { createHmac, timingSafeEqual } from 'node:crypto';
import { optionalEnv } from './env.js';

/**
 * Provider-specific webhook signature verification.
 *
 *   Moonpay: HMAC-SHA256 of raw body with MOONPAY_WEBHOOK_SECRET,
 *            delivered in `Moonpay-Signature-V2`.
 *   Transak: HMAC-SHA256 of raw body with TRANSAK_WEBHOOK_SECRET,
 *            delivered in `x-transak-signature`.
 *
 * Both providers ship at /v1/onramp/webhook?provider=moonpay|transak.
 */
export type Provider = 'moonpay' | 'transak';

function constantEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyMoonpaySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = optionalEnv('MOONPAY_WEBHOOK_SECRET');
  if (!secret || !signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return constantEq(expected, signatureHeader);
}

export function verifyTransakSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = optionalEnv('TRANSAK_WEBHOOK_SECRET');
  if (!secret || !signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return constantEq(expected, signatureHeader);
}

export function verifyWebhookSignature(
  provider: Provider,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const get = (k: string) => {
    const v = headers[k] ?? headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  if (provider === 'moonpay') return verifyMoonpaySignature(rawBody, get('moonpay-signature-v2') as string);
  if (provider === 'transak') return verifyTransakSignature(rawBody, get('x-transak-signature') as string);
  return false;
}

export interface NormalizedOrder {
  externalId: string;
  walletAddr: string;
  amountFiat?: string;
  currencyFiat?: string;
  amountCrypto?: string;
  currencyCrypto?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export function normalize(provider: Provider, body: any): NormalizedOrder | null {
  if (provider === 'moonpay') {
    const t = body?.data ?? body;
    if (!t?.id || !t?.walletAddress) return null;
    const statusMap: Record<string, NormalizedOrder['status']> = {
      pending: 'pending',
      waitingPayment: 'pending',
      waitingAuthorization: 'processing',
      completed: 'completed',
      failed: 'failed',
    };
    return {
      externalId: String(t.id),
      walletAddr: String(t.walletAddress),
      amountFiat: t.baseCurrencyAmount?.toString(),
      currencyFiat: t.baseCurrency?.code?.toUpperCase(),
      amountCrypto: t.quoteCurrencyAmount?.toString(),
      currencyCrypto: t.currency?.code?.toUpperCase(),
      status: statusMap[t.status as string] ?? 'pending',
    };
  }
  if (provider === 'transak') {
    const t = body?.webhookData ?? body;
    if (!t?.id || !t?.walletAddress) return null;
    const statusMap: Record<string, NormalizedOrder['status']> = {
      PROCESSING: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed',
      EXPIRED: 'failed',
      CANCELLED: 'failed',
    };
    return {
      externalId: String(t.id),
      walletAddr: String(t.walletAddress),
      amountFiat: t.fiatAmount?.toString(),
      currencyFiat: t.fiatCurrency?.toUpperCase(),
      amountCrypto: t.cryptoAmount?.toString(),
      currencyCrypto: t.cryptoCurrency?.toUpperCase(),
      status: statusMap[t.status as string] ?? 'pending',
    };
  }
  return null;
}
