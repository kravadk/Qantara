import { Router, type Request, type Response } from 'express';
import type { Address } from 'viem';
import * as store from '../lib/store.js';
import { buildPaymentIntent, verifyPaymentIntent } from '../lib/paymentIntents.js';
import { type AuthIdentity, identityCanAccessMerchant, identityHasMerchantBoundary, validateBearerIdentity } from '../lib/authIdentity.js';
import { parsePagination } from '../lib/pagination.js';

const router = Router();

type PaymentIntentLocals = {
  apiKeyIdentity: AuthIdentity;
};

function publicIntent(intent: store.PaymentIntent) {
  return {
    id: intent.id,
    invoiceHash: intent.invoiceHash,
    merchant: intent.merchant,
    payer: intent.payer,
    token: intent.token,
    amount: intent.amount,
    deadline: intent.deadline,
    usedAt: intent.usedAt,
    createdAt: intent.createdAt,
  };
}

function requireApiKey(requiredScope: string) {
  return async (req: Request, res: Response<any, PaymentIntentLocals>, next: () => void) => {
    const auth = req.header('Authorization') ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    const identity = m ? await validateBearerIdentity(m[1], requiredScope) : undefined;
    if (!identity) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.locals.apiKeyIdentity = identity;
    next();
  };
}

function requireMerchantAccess(res: Response<any, PaymentIntentLocals>, merchant: string): boolean {
  const identity = res.locals.apiKeyIdentity;
  if (!identityHasMerchantBoundary(identity)) {
    res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot access payment intents',
    });
    return false;
  }
  if (!identityCanAccessMerchant(identity, merchant)) {
    res.status(403).json({
      error: 'merchant_scope_mismatch',
      message: 'Stored merchant API keys can only access payment intents for their own merchant',
    });
    return false;
  }
  return true;
}

function intentExpired(intent: store.PaymentIntent): boolean {
  return Math.floor(Date.now() / 1000) > intent.deadline;
}

router.post('/', requireApiKey('invoices:write'), (req: Request, res: Response<any, PaymentIntentLocals>) => {
  const { invoice_hash, payer, ttl_seconds } = req.body ?? {};
  if (!invoice_hash || typeof invoice_hash !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'invoice_hash is required' });
  }
  if (payer !== undefined && (typeof payer !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(payer))) {
    return res.status(400).json({ error: 'bad_request', message: 'payer must be a 0x address when provided' });
  }
  const invoice = store.getInvoice(invoice_hash);
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  if (!requireMerchantAccess(res, invoice.merchant)) return;
  if (invoice.status !== store.InvoiceStatus.Created) {
    return res.status(400).json({ error: 'bad_state', message: 'payment intents can only be created for open invoices' });
  }
  try {
    const intent = buildPaymentIntent({
      invoice,
      payer: payer ? payer.toLowerCase() as Address : undefined,
      ttlSeconds: typeof ttl_seconds === 'number' ? ttl_seconds : undefined,
    });
    res.status(201).json({ intent });
  } catch (err: any) {
    res.status(503).json({ error: 'intent_signing_unavailable', message: err?.message ?? 'Could not sign payment intent' });
  }
});

router.get('/', requireApiKey('invoices:read'), (req: Request, res: Response<any, PaymentIntentLocals>) => {
  const invoiceHash = typeof req.query.invoice_hash === 'string' ? req.query.invoice_hash : undefined;
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 200 });
  if (!identityHasMerchantBoundary(res.locals.apiKeyIdentity)) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot list payment intents',
    });
  }
  if (invoiceHash) {
    const invoice = store.getInvoice(invoiceHash);
    if (!invoice) return res.status(404).json({ error: 'not_found' });
    if (!requireMerchantAccess(res, invoice.merchant)) return;
  }
  const result = store.listPaymentIntents({
    invoiceHash,
    merchant: res.locals.apiKeyIdentity.kind === 'stored' || res.locals.apiKeyIdentity.kind === 'session' ? res.locals.apiKeyIdentity.merchant : undefined,
    limit,
    offset,
  });
  res.json({ count: result.intents.length, total: result.total, limit, offset, intents: result.intents.map(publicIntent) });
});

router.post('/:id/verify', requireApiKey('invoices:read'), (req: Request, res: Response<any, PaymentIntentLocals>) => {
  const intent = store.getPaymentIntent(req.params.id);
  if (!intent) return res.status(404).json({ error: 'not_found' });
  if (!requireMerchantAccess(res, intent.merchant)) return;
  const ok = verifyPaymentIntent({
    invoiceHash: intent.invoiceHash,
    merchant: intent.merchant,
    payer: intent.payer,
    token: intent.token,
    amount: intent.amount,
    deadline: intent.deadline,
    nonce: intent.nonce,
  }, intent.signature);
  const expired = intentExpired(intent);
  const used = !!intent.usedAt;
  res.json({ ok: ok && !expired && !used, signatureValid: ok, expired, used, intent: publicIntent(intent) });
});

router.post('/:id/use', requireApiKey('invoices:write'), (req: Request, res: Response<any, PaymentIntentLocals>) => {
  const existing = store.getPaymentIntent(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (!requireMerchantAccess(res, existing.merchant)) return;
  if (existing.usedAt) {
    return res.status(409).json({
      error: 'intent_already_used',
      message: 'Payment intent has already been used',
      intent: publicIntent(existing),
    });
  }
  if (intentExpired(existing)) {
    return res.status(409).json({
      error: 'intent_expired',
      message: 'Payment intent deadline has passed',
      intent: publicIntent(existing),
    });
  }
  const intent = store.markPaymentIntentUsed(req.params.id);
  if (!intent) return res.status(404).json({ error: 'not_found' });
  store.appendInvoiceEvent(intent.invoiceHash, 'payment_intent.used', { intentId: intent.id });
  res.json({ ok: true, intent: publicIntent(intent) });
});

export default router;
