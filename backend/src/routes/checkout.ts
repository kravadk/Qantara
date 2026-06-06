import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { dispatchWebhook } from '../lib/webhooks.js';
import {
  apiKeyCanAccessMerchant,
  apiKeyHasMerchantBoundary,
  type ApiKeyIdentity,
  optionalEnv,
  validateConfiguredOrStoredApiKeyIdentity,
} from '../lib/env.js';

const router = Router();
const FRONTEND_URL = optionalEnv('QANTARA_FRONTEND_URL');
const MAX_AMOUNT_LENGTH = 80;
const MAX_MEMO_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MIN_CHECKOUT_TTL_SECONDS = 300;
const MAX_CHECKOUT_TTL_SECONDS = 30 * 24 * 60 * 60;

type CheckoutLocals = {
  apiKeyIdentity: ApiKeyIdentity;
};

/**
 * Auth middleware. Validates `Authorization: Bearer <API_KEY>`.
 * Production: per-merchant API keys in DB.
 */
function requireApiKey(req: Request, res: Response<any, CheckoutLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? validateConfiguredOrStoredApiKeyIdentity(m[1], 'invoices:write') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' });
  }
  res.locals.apiKeyIdentity = identity;
  next();
}

function requireMerchantAccess(res: Response<any, CheckoutLocals>, merchant: string): boolean {
  const identity = res.locals.apiKeyIdentity;
  if (!apiKeyHasMerchantBoundary(identity)) {
    res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot access checkout sessions',
    });
    return false;
  }
  if (!apiKeyCanAccessMerchant(identity, merchant)) {
    res.status(403).json({
      error: 'merchant_scope_mismatch',
      message: 'Stored merchant API keys can only access checkout sessions for their own merchant',
    });
    return false;
  }
  return true;
}

function normalizeCheckoutUrl(value: unknown, field: string, res: Response, allowLoopbackHttp = false): string | undefined | false {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: 'bad_request', message: `${field} must be a URL string up to ${MAX_URL_LENGTH} characters` });
    return false;
  }
  try {
    const parsed = new URL(value);
    const isLoopbackHttp = parsed.protocol === 'http:' &&
      allowLoopbackHttp &&
      ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
      res.status(400).json({ error: 'bad_request', message: `${field} must use https` });
      return false;
    }
    return parsed.toString();
  } catch {
    res.status(400).json({ error: 'bad_request', message: `${field} must be a valid URL` });
    return false;
  }
}

function normalizeMemo(value: unknown, res: Response): string | undefined | false {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_MEMO_LENGTH) {
    res.status(400).json({ error: 'bad_request', message: `memo must be ${MAX_MEMO_LENGTH} characters or fewer` });
    return false;
  }
  return value.trim() || undefined;
}

function resolveSessionHash(id: string): string | undefined | false {
  if (/^0x[a-fA-F0-9]{64}$/.test(id)) return id;
  if (!/^cs_[a-fA-F0-9]{16}$/.test(id)) return false;
  return store.getInvoiceBySessionId(id)?.hash;
}

/**
 * POST /v1/checkout/sessions — create a hosted checkout session.
 */
router.post('/sessions', requireApiKey, async (req: Request, res: Response<any, CheckoutLocals>) => {
  const { amount, token = 'QUSDC', merchant, memo, success_url, cancel_url, webhook_url, expires_in = 86400, chain_tx_hash } = req.body ?? {};

  if (
    !amount ||
    typeof amount !== 'string' ||
    amount.length > MAX_AMOUNT_LENGTH ||
    !/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,18})?$/.test(amount)
  ) {
    return res.status(400).json({ error: 'bad_request', message: 'amount must be a positive decimal string' });
  }
  if (!merchant || !/^0x[a-fA-F0-9]{40}$/.test(merchant)) {
    return res.status(400).json({ error: 'bad_request', message: 'merchant must be a valid 0x address' });
  }
  if (!requireMerchantAccess(res, merchant)) return;
  if (!['QIE', 'QUSDC'].includes(token)) {
    return res.status(400).json({ error: 'bad_request', message: 'token must be "QIE" or "QUSDC"' });
  }
  if (!FRONTEND_URL) {
    return res.status(503).json({ error: 'frontend_not_configured', message: 'QANTARA_FRONTEND_URL is required for checkout sessions' });
  }
  if (!chain_tx_hash || typeof chain_tx_hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(chain_tx_hash)) {
    return res.status(400).json({
      error: 'chain_tx_hash_required',
      message: 'Checkout sessions must mirror an on-chain Qantara createInvoice transaction',
    });
  }
  const ttl = Number(expires_in);
  if (!Number.isInteger(ttl) || ttl < MIN_CHECKOUT_TTL_SECONDS || ttl > MAX_CHECKOUT_TTL_SECONDS) {
    return res.status(400).json({
      error: 'bad_request',
      message: `expires_in must be an integer from ${MIN_CHECKOUT_TTL_SECONDS} to ${MAX_CHECKOUT_TTL_SECONDS} seconds`,
    });
  }
  const safeMemo = normalizeMemo(memo, res);
  if (safeMemo === false) return;
  const safeSuccessUrl = normalizeCheckoutUrl(success_url, 'success_url', res);
  if (safeSuccessUrl === false) return;
  const safeCancelUrl = normalizeCheckoutUrl(cancel_url, 'cancel_url', res);
  if (safeCancelUrl === false) return;
  const safeWebhookUrl = normalizeCheckoutUrl(webhook_url, 'webhook_url', res, true);
  if (safeWebhookUrl === false) return;

  const tokenAddr = token === 'QIE'
    ? '0x0000000000000000000000000000000000000000' as const
    : optionalEnv('QUSDC_ADDRESS') as `0x${string}` | undefined;
  if (!tokenAddr || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddr)) {
    return res.status(503).json({ error: 'token_not_configured', message: 'QUSDC_ADDRESS is required for QUSDC checkout sessions' });
  }

  const inv = store.createInvoice({
    merchant: merchant.toLowerCase() as `0x${string}`,
    amount,
    token: tokenAddr,
    expiresAt: Math.floor(Date.now() / 1000) + ttl,
    memo: safeMemo,
    webhookUrl: safeWebhookUrl,
    successUrl: safeSuccessUrl,
    cancelUrl: safeCancelUrl,
    chainTxHash: chain_tx_hash as `0x${string}`,
  });

  void dispatchWebhook(inv, 'invoice.created');

  res.status(201).json({
    id: `cs_${inv.hash.slice(2, 18)}`,
    invoice_hash: inv.hash,
    url: `${FRONTEND_URL}/checkout/${inv.hash}`,
    pay_url: `${FRONTEND_URL}/pay/${inv.hash}`,
    expires_at: inv.expiresAt,
    status: 'open',
    amount: inv.amount,
    token,
    memo: inv.memo,
  });
});

/**
 * GET /v1/checkout/sessions/:id — poll status. Accepts cs_… or 0x… hash.
 */
router.get('/sessions/:id', requireApiKey, (req: Request, res: Response<any, CheckoutLocals>) => {
  const { id } = req.params;
  const hash = resolveSessionHash(id);
  if (hash === false) return res.status(400).json({ error: 'bad_request', message: 'session id must be cs_<16 hex> or a 0x-prefixed 32-byte hash' });
  if (!hash) return res.status(404).json({ error: 'not_found' });
  const inv = store.getInvoice(hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!requireMerchantAccess(res, inv.merchant)) return;

  res.json({
    id: `cs_${inv.hash.slice(2, 18)}`,
    invoice_hash: inv.hash,
    status: ['open', 'paid', 'cancelled', 'refunded', 'paused'][inv.status],
    amount: inv.amount,
    token: inv.token,
    payer: inv.payer,
    paid_at: inv.paidAt,
    tx_hash: inv.paidTxHash,
    expires_at: inv.expiresAt,
  });
});

router.post('/sessions/:id/cancel', requireApiKey, async (req: Request, res: Response<any, CheckoutLocals>) => {
  const { id } = req.params;
  const hash = resolveSessionHash(id);
  if (hash === false) return res.status(400).json({ error: 'bad_request', message: 'session id must be cs_<16 hex> or a 0x-prefixed 32-byte hash' });
  if (!hash) return res.status(404).json({ error: 'not_found' });
  const inv = store.getInvoice(hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!requireMerchantAccess(res, inv.merchant)) return;
  res.status(410).json({
    error: 'verified_lifecycle_required',
    invoice_hash: hash,
    message: 'Checkout cancellation is recorded only after a verified Qantara cancel transaction. Use /v1/invoices/:hash/cancel/verify.',
  });
});

export default router;
