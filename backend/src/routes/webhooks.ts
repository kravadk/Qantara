import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { dispatchWebhook, retryDueWebhooks, retryWebhookDelivery } from '../lib/webhooks.js';
import { type AuthIdentity, identityCanAccessMerchant, identityHasMerchantBoundary, validateBearerIdentity } from '../lib/authIdentity.js';
import { parsePagination } from '../lib/pagination.js';

const router = Router();

type WebhookLocals = {
  apiKeyIdentity: AuthIdentity;
};

async function requireApiKey(req: Request, res: Response<any, WebhookLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'webhooks:write') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.locals.apiKeyIdentity = identity;
  next();
}

async function requireWebhookRead(req: Request, res: Response<any, WebhookLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'webhooks:read') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.locals.apiKeyIdentity = identity;
  next();
}

function requireMerchantAccess(res: Response<any, WebhookLocals>, merchant: string): boolean {
  const identity = res.locals.apiKeyIdentity;
  if (!identityHasMerchantBoundary(identity)) {
    res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot access webhook resources',
    });
    return false;
  }
  if (!identityCanAccessMerchant(identity, merchant)) {
    res.status(403).json({
      error: 'merchant_scope_mismatch',
      message: 'Stored merchant API keys can only access webhook resources for their own merchant',
    });
    return false;
  }
  return true;
}

function canAccessDelivery(res: Response<any, WebhookLocals>, delivery: store.WebhookDelivery): boolean {
  const inv = store.getInvoice(delivery.invoiceHash);
  if (!inv) {
    res.status(404).json({ error: 'not_found' });
    return false;
  }
  return requireMerchantAccess(res, inv.merchant);
}

router.get('/deliveries', requireWebhookRead, (req: Request, res: Response<any, WebhookLocals>) => {
  const invoiceHash = typeof req.query.invoice_hash === 'string' ? req.query.invoice_hash : undefined;
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 200 });
  if (!identityHasMerchantBoundary(res.locals.apiKeyIdentity)) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot list webhook deliveries',
    });
  }
  if (invoiceHash) {
    const inv = store.getInvoice(invoiceHash);
    if (!inv) return res.status(404).json({ error: 'not_found' });
    if (!requireMerchantAccess(res, inv.merchant)) return;
  }
  const result = store.listWebhookDeliveries({
    invoiceHash,
    merchant: res.locals.apiKeyIdentity.kind === 'stored' || res.locals.apiKeyIdentity.kind === 'session' ? res.locals.apiKeyIdentity.merchant : undefined,
    limit,
    offset,
  });
  res.json({ count: result.deliveries.length, total: result.total, limit, offset, deliveries: result.deliveries });
});

router.post('/deliveries/:id/retry', requireApiKey, async (req: Request, res: Response<any, WebhookLocals>) => {
  try {
    const existing = store.getWebhookDelivery(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (!canAccessDelivery(res, existing)) return;
    const delivery = await retryWebhookDelivery(req.params.id);
    res.json({ ok: true, delivery });
  } catch (err: any) {
    const message = err?.message ?? 'Webhook retry failed';
    const status = message === 'webhook_already_succeeded' || message === 'webhook_max_attempts_reached' ? 409 : 400;
    res.status(status).json({ error: message === 'webhook_already_succeeded' ? 'webhook_already_succeeded' : 'retry_failed', message });
  }
});

router.post('/retry-due', requireApiKey, async (req: Request, res: Response<any, WebhookLocals>) => {
  if (res.locals.apiKeyIdentity.kind !== 'operator') {
    return res.status(403).json({
      error: 'operator_required',
      message: 'Global webhook retry requires the operator API key',
    });
  }
  const limit = typeof req.body?.limit === 'number' ? req.body.limit : 25;
  const result = await retryDueWebhooks(limit);
  res.json({ ok: true, ...result });
});

router.post('/test', requireApiKey, async (req: Request, res: Response<any, WebhookLocals>) => {
  const { invoice_hash } = req.body ?? {};
  if (!invoice_hash || typeof invoice_hash !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'invoice_hash is required' });
  }
  const inv = store.getInvoice(invoice_hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!requireMerchantAccess(res, inv.merchant)) return;
  if (!inv.webhookUrl) return res.status(400).json({ error: 'webhook_not_configured' });
  await dispatchWebhook(inv, 'invoice.created', { memo: 'webhook connectivity test' });
  const result = store.listWebhookDeliveries({ invoiceHash: inv.hash, limit: 5 });
  res.json({ ok: true, deliveries: result.deliveries });
});

function callerMerchant(res: Response<any, WebhookLocals>): `0x${string}` | undefined {
  const identity = res.locals.apiKeyIdentity;
  return identity.kind === 'stored' || identity.kind === 'session' ? identity.merchant : undefined;
}

// Self-serve: the merchant views its own webhook signing secret (used to verify
// X-Qantara-Signature on its endpoint). Lazily provisioned on first read.
router.get('/secret', requireWebhookRead, (_req: Request, res: Response<any, WebhookLocals>) => {
  const merchant = callerMerchant(res);
  if (!merchant) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'A merchant wallet session or merchant-scoped API key is required to manage webhook secrets',
    });
  }
  const record = store.ensureMerchantWebhookSecret(merchant);
  res.json({ merchant, secret: record.secret, createdAt: record.createdAt, rotatedAt: record.rotatedAt });
});

router.post('/secret/rotate', requireApiKey, (_req: Request, res: Response<any, WebhookLocals>) => {
  const merchant = callerMerchant(res);
  if (!merchant) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'A merchant wallet session or merchant-scoped API key is required to rotate webhook secrets',
    });
  }
  const record = store.rotateMerchantWebhookSecret(merchant);
  res.json({ ok: true, merchant, secret: record.secret, createdAt: record.createdAt, rotatedAt: record.rotatedAt });
});

export default router;
