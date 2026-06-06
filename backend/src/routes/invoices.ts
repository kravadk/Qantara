import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { dispatchWebhook } from '../lib/webhooks.js';
import { type AuthIdentity, identityCanAccessMerchant, identityHasMerchantBoundary, validateBearerIdentity } from '../lib/authIdentity.js';
import { verifyNativePayment, verifyNativeRefund, verifyQantaraLifecycleEvent, verifyQantaraRefundEvent, verifyTokenPayment, verifyTokenRefund } from '../lib/chain.js';
import { verifyInvoiceCreateSignature } from '../lib/invoiceSigning.js';
import { parsePagination } from '../lib/pagination.js';

const router = Router();
const MESSAGE_LIMIT_WINDOW_SECONDS = 60;
const MESSAGE_LIMIT_MAX = 12;
const INVOICE_VIEWED_WINDOW_SECONDS = 300;
const GUEST_TOKEN_PATTERN = /^gst_[A-Za-z0-9_-]{32}$/;
const MAX_MESSAGE_BODY_LENGTH = 2000;
const MAX_MESSAGE_LABEL_LENGTH = 80;

async function requestIdentity(req: Request, requiredScope = 'invoices:write'): Promise<AuthIdentity | undefined> {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  return m?.[1] ? await validateBearerIdentity(m[1], requiredScope) : undefined;
}

async function hasApiKey(req: Request, requiredScope = 'invoices:write'): Promise<boolean> {
  return !!await requestIdentity(req, requiredScope);
}

async function requireApiKey(req: Request, res: Response, next: () => void) {
  if (!await hasApiKey(req, 'invoices:write')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

async function requireInvoiceMerchant(req: Request, res: Response, inv: store.Invoice, requiredScope = 'invoices:write'): Promise<boolean> {
  const identity = await requestIdentity(req, requiredScope);
  if (!identity) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  if (!identityHasMerchantBoundary(identity)) {
    res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot access merchant invoice resources',
    });
    return false;
  }
  if (!identityCanAccessMerchant(identity, inv.merchant)) {
    res.status(403).json({
      error: 'merchant_scope_mismatch',
      message: 'Stored merchant API keys can only access invoices for their own merchant',
    });
    return false;
  }
  return true;
}

async function hasInvoiceMerchantAccess(req: Request, inv: store.Invoice): Promise<boolean> {
  const identity = await requestIdentity(req, 'invoices:write') ?? await requestIdentity(req, 'invoices:read');
  return !!identity && identityCanAccessMerchant(identity, inv.merchant);
}

async function hasInvoiceMerchantReadAccess(req: Request, inv: store.Invoice): Promise<boolean> {
  const identity = await requestIdentity(req, 'invoices:read');
  return !!identity && identityCanAccessMerchant(identity, inv.merchant);
}

function normalizedGuestToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  return GUEST_TOKEN_PATTERN.test(token) ? token : undefined;
}

function guestToken(req: Request): string | undefined {
  return normalizedGuestToken(req.header('x-qantara-guest-token')) ?? normalizedGuestToken(req.query.guest_token);
}

function hasInvalidGuestToken(req: Request, includeBody = false): boolean {
  const values: unknown[] = [req.header('x-qantara-guest-token'), req.query.guest_token];
  if (includeBody) values.push(req.body?.guest_token);
  return values.some((value) => typeof value === 'string' && value.trim() !== '' && !normalizedGuestToken(value));
}

async function requireConversationAccess(req: Request, res: Response, inv: store.Invoice): Promise<boolean> {
  if (hasInvalidGuestToken(req)) {
    res.status(403).json({ error: 'forbidden', message: 'Invalid conversation token' });
    return false;
  }
  const ok = store.hasConversationAccess(req.params.hash, {
    isMerchant: await hasInvoiceMerchantAccess(req, inv),
    guestToken: guestToken(req),
  });
  if (!ok) {
    res.status(403).json({ error: 'forbidden', message: 'Invalid conversation token' });
  }
  return ok;
}

function requirePayerRefundAccess(req: Request, res: Response, inv: store.Invoice): boolean {
  if (hasInvalidGuestToken(req, true)) {
    res.status(403).json({ error: 'forbidden', message: 'Invalid conversation token' });
    return false;
  }
  const token = guestToken(req) ?? normalizedGuestToken(req.body?.guest_token);
  if (!token || inv.guestToken !== token) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Refund requests require the payer guest session for this invoice',
    });
    return false;
  }
  return true;
}

function messageRateLimit(req: Request, res: Response): boolean {
  const since = Math.floor(Date.now() / 1000) - MESSAGE_LIMIT_WINDOW_SECONDS;
  if (store.countRecentMessages(req.params.hash, since) >= MESSAGE_LIMIT_MAX) {
    res.status(429).json({ error: 'rate_limited', message: 'Too many messages. Try again shortly.' });
    return false;
  }
  return true;
}

function shouldRecordInvoiceViewed(hash: string): boolean {
  const since = Math.floor(Date.now() / 1000) - INVOICE_VIEWED_WINDOW_SECONDS;
  return store.countInvoiceEvents(hash, 'invoice.viewed', since) === 0;
}

function validateMessageInput(req: Request, res: Response): boolean {
  const body = req.body?.body;
  const label = req.body?.sender_label;
  if (typeof body !== 'string' || body.trim() === '') {
    res.status(400).json({ error: 'bad_request', message: 'message body is required' });
    return false;
  }
  if (body.length > MAX_MESSAGE_BODY_LENGTH) {
    res.status(400).json({ error: 'bad_request', message: `message body must be ${MAX_MESSAGE_BODY_LENGTH} characters or fewer` });
    return false;
  }
  if (label !== undefined && (typeof label !== 'string' || label.length > MAX_MESSAGE_LABEL_LENGTH)) {
    res.status(400).json({ error: 'bad_request', message: `sender_label must be ${MAX_MESSAGE_LABEL_LENGTH} characters or fewer` });
    return false;
  }
  if (hasInvalidGuestToken(req, true)) {
    res.status(403).json({ error: 'forbidden', message: 'Invalid conversation token' });
    return false;
  }
  return true;
}

async function verifyContractLifecycleAction(
  req: Request,
  res: Response,
  action: 'cancel' | 'pause' | 'resume',
) {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;

  const txHash = req.body?.tx_hash;
  if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'bad_request', message: 'tx_hash required (0x...64 hex)' });
  }

  const eventByAction = {
    cancel: 'InvoiceCancelled',
    pause: 'InvoicePaused',
    resume: 'InvoiceResumed',
  } as const;
  const storeAction = {
    cancel: store.cancelInvoice,
    pause: store.pauseInvoice,
    resume: store.resumeInvoice,
  } as const;

  try {
    const verified = await verifyQantaraLifecycleEvent({
      txHash: txHash as `0x${string}`,
      invoiceHash: inv.hash,
      merchant: inv.merchant,
      eventName: eventByAction[action],
    });
    const updated = storeAction[action](inv.hash);
    if (!updated) return res.status(404).json({ error: 'not_found' });
    store.recordChainEvent({
      contractAddress: verified.contractAddress,
      invoiceHash: inv.hash,
      eventType: verified.eventType,
      txHash: txHash as `0x${string}`,
      blockNumber: verified.blockNumber,
      logIndex: verified.logIndex,
      payload: { verifiedBy: 'merchant-action' },
    });
    void dispatchWebhook(updated, verified.eventType as any);
    res.json({ ok: true, invoice: updated, chain: verified });
  } catch (err: any) {
    res.status(400).json({ error: 'lifecycle_not_verified', message: err?.message ?? 'Lifecycle action could not be verified' });
  }
}

function recordPaymentVerificationFailure(inv: store.Invoice, input: { payer?: unknown; txHash?: unknown; error: unknown }) {
  store.appendInvoiceEvent(inv.hash, 'payment.verification_failed', {
    payer: typeof input.payer === 'string' ? input.payer.toLowerCase() : undefined,
    txHash: typeof input.txHash === 'string' ? input.txHash.toLowerCase() : undefined,
    reason: input.error instanceof Error ? input.error.message : String(input.error || 'Payment could not be verified'),
  });
}

function publicMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const denied = /(secret|api[_-]?key|authorization|bearer|guest[_-]?token|webhook|delivery|internal|target[_-]?url)/i;
  const clean = Object.entries(metadata).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (denied.test(key)) return acc;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = publicMetadata(value as Record<string, unknown>);
      if (nested && Object.keys(nested).length > 0) acc[key] = nested;
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function publicInvoice(inv: store.Invoice) {
  const {
    webhookUrl: _webhookUrl,
    successUrl,
    cancelUrl,
    guestToken: _guestToken,
    webhookEvents: _webhookEvents,
    metadata,
    ...publicInv
  } = inv;
  return {
    ...publicInv,
    metadata: publicMetadata(metadata),
    has_success_url: !!successUrl,
    has_cancel_url: !!cancelUrl,
  };
}

function publicInvoiceEvent(event: store.InvoiceEvent, merchantView: boolean): store.InvoiceEvent {
  if (merchantView) return event;
  if (event.type === 'payment.verification_failed') {
    return { ...event, payload: {} };
  }
  const payload = publicMetadata(event.payload) ?? {};
  return { ...event, payload };
}

function eventReplayCursor(req: Request): string | undefined {
  const queryAfter = typeof req.query.after === 'string' ? req.query.after.trim() : undefined;
  const lastEventId = req.header('Last-Event-ID')?.trim();
  return queryAfter || lastEventId || undefined;
}

/**
 * GET /v1/invoices/:hash — public read for Pay.tsx / Checkout.tsx.
 * Strips webhook config from response.
 */
router.get('/:hash', async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (shouldRecordInvoiceViewed(inv.hash)) {
    store.appendInvoiceEvent(inv.hash, 'invoice.viewed', {
      viewer: await hasInvoiceMerchantAccess(req, inv) ? 'merchant' : 'public',
      userAgent: req.header('user-agent')?.slice(0, 160),
    });
  }

  res.json(publicInvoice(inv));
});

/**
 * GET /v1/invoices/:hash/return?type=success|cancel — post-payment return hop.
 * Redirects the payer to the merchant's configured success/cancel URL. The URL
 * stays server-side (never exposed in the public invoice JSON); success requires
 * the invoice to be paid to avoid redirecting before settlement.
 */
router.get('/:hash/return', (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  const type = req.query.type === 'cancel' ? 'cancel' : 'success';
  const target = type === 'cancel' ? inv.cancelUrl : inv.successUrl;
  if (!target || !/^https?:\/\//i.test(target)) {
    return res.status(404).json({ error: 'return_url_not_configured' });
  }
  if (type === 'success' && inv.status !== store.InvoiceStatus.Paid) {
    return res.status(409).json({ error: 'not_paid', message: 'Success return is only available after payment is settled' });
  }
  return res.redirect(302, target);
});

/**
 * GET /v1/invoices?merchant=0x…&status=0 — list (public).
 */
router.get('/', async (req: Request, res: Response) => {
  const { merchant, payer, status, demo, limit, offset } = req.query;
  const identity = await requestIdentity(req, 'invoices:read') ?? await requestIdentity(req, 'invoices:write');
  const parsedLimit = typeof limit === 'string' ? Number(limit) : undefined;
  const parsedOffset = typeof offset === 'string' ? Number(offset) : undefined;
  const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(200, parsedLimit as number)) : 100;
  const safeOffset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset as number) : 0;
  let merchantFilter = typeof merchant === 'string' && /^0x[a-fA-F0-9]{40}$/.test(merchant)
    ? (merchant.toLowerCase() as `0x${string}`)
    : undefined;
  const payerFilter = typeof payer === 'string' && /^0x[a-fA-F0-9]{40}$/.test(payer)
    ? (payer.toLowerCase() as `0x${string}`)
    : undefined;

  if (identity) {
    if (!identityHasMerchantBoundary(identity)) {
      return res.status(403).json({
        error: 'merchant_boundary_required',
        message: 'Stored API keys without a merchant boundary cannot list merchant invoice resources',
      });
    }
    if (identity.kind === 'stored' || identity.kind === 'session') {
      if (merchantFilter && !identityCanAccessMerchant(identity, merchantFilter)) {
        return res.status(403).json({
          error: 'merchant_scope_mismatch',
          message: 'Stored merchant API keys can only list invoices for their own merchant',
        });
      }
      merchantFilter = identity.merchant;
    }
  }

  if (!identity && !merchantFilter && !payerFilter) {
    return res.status(400).json({
      error: 'filter_required',
      message: 'Public invoice listing requires a merchant or payer address filter',
    });
  }

  const { invoices, total } = store.listInvoices({
    merchant: merchantFilter,
    payer: payerFilter,
    status: typeof status === 'string' ? Number(status) as any : undefined,
    demo: demo === 'true' ? true : demo === 'false' ? false : undefined,
    limit: safeLimit,
    offset: safeOffset,
  });
  const sanitized = invoices.map(publicInvoice);
  res.json({
    count: sanitized.length,
    total,
    limit: safeLimit,
    offset: safeOffset,
    invoices: sanitized,
  });
});

/**
 * POST /v1/invoices — wallet-app invoice creation backed by the API database.
 * This is not a payment simulation: it creates a real hosted invoice record that must be paid
 * with a blockchain transaction and verified through /v1/invoices/:hash/verify-payment.
 */
router.post('/', async (req: Request, res: Response) => {
  const {
    amount,
    merchant,
    token = 'QIE',
    memo,
    title,
    expires_at,
    invoice_type = 0,
    metadata,
    hash,
    chain_tx_hash,
    merchant_signature,
    merchant_nonce,
    signed_at,
  } = req.body ?? {};
  if (!amount || typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) {
    return res.status(400).json({ error: 'bad_request', message: 'amount (decimal string) is required' });
  }
  if (!merchant || !/^0x[a-fA-F0-9]{40}$/.test(merchant)) {
    return res.status(400).json({ error: 'bad_request', message: 'merchant must be a valid 0x address' });
  }
  if (!['QIE', 'QUSDC'].includes(String(token))) {
    return res.status(400).json({ error: 'bad_request', message: 'token must be QIE or QUSDC' });
  }
  if (hash !== undefined && (typeof hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(hash))) {
    return res.status(400).json({ error: 'bad_request', message: 'hash must be a 0x-prefixed 32-byte hex string' });
  }
  if (chain_tx_hash !== undefined && (typeof chain_tx_hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(chain_tx_hash))) {
    return res.status(400).json({ error: 'bad_request', message: 'chain_tx_hash must be a 0x-prefixed 32-byte hex string' });
  }

  const tokenAddr = token === 'QIE'
    ? '0x0000000000000000000000000000000000000000' as const
    : (process.env.QUSDC_ADDRESS as `0x${string}` | undefined);
  if (!tokenAddr || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddr)) {
    return res.status(503).json({ error: 'token_not_configured', message: 'QUSDC_ADDRESS is required for QUSDC invoices' });
  }

  const isDemo = typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && metadata.demo === true;
  const identity = await requestIdentity(req, 'invoices:write');
  if (identity) {
    if (!identityHasMerchantBoundary(identity)) {
      return res.status(403).json({
        error: 'merchant_boundary_required',
        message: 'Stored API keys without a merchant boundary cannot create merchant invoice resources',
      });
    }
    if (!identityCanAccessMerchant(identity, merchant.toLowerCase())) {
      return res.status(403).json({
        error: 'merchant_scope_mismatch',
        message: 'Stored merchant API keys can only create invoices for their own merchant',
      });
    }
  }
  if (!identity && !isDemo) {
    if (
      typeof merchant_signature !== 'string' ||
      !/^0x[a-fA-F0-9]+$/.test(merchant_signature) ||
      typeof merchant_nonce !== 'string' ||
      typeof signed_at !== 'number'
    ) {
      return res.status(401).json({
        error: 'signature_required',
        message: 'Production invoice creation requires an API key or merchant wallet signature',
      });
    }
    const verified = await verifyInvoiceCreateSignature({
      payload: {
        merchant: merchant.toLowerCase() as `0x${string}`,
        amount,
        token: token as 'QIE' | 'QUSDC',
        invoiceType: Number(invoice_type),
        expiresAt: Number(expires_at || 0),
        title,
        memo,
        metadata: typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) ? metadata : undefined,
        hash: hash as `0x${string}` | undefined,
        chainTxHash: chain_tx_hash as `0x${string}` | undefined,
        nonce: merchant_nonce,
        signedAt: signed_at,
      },
      signature: merchant_signature as `0x${string}`,
    });
    if (!verified.ok) {
      return res.status(401).json({ error: verified.error });
    }
  }
  if (!isDemo && !chain_tx_hash) {
    return res.status(400).json({
      error: 'chain_tx_hash_required',
      message: 'Production invoice records must reference the on-chain createInvoice transaction',
    });
  }

  // Per-merchant daily quota (anti-abuse for public self-serve). Operator key and
  // demo invoices are exempt. Disable with MERCHANT_DAILY_INVOICE_QUOTA=0.
  const dailyQuota = Number(process.env.MERCHANT_DAILY_INVOICE_QUOTA ?? '1000');
  if (!isDemo && identity?.kind !== 'operator' && dailyQuota > 0) {
    const since = Math.floor(Date.now() / 1000) - 86_400;
    if (store.countInvoicesSince(merchant.toLowerCase() as `0x${string}`, since) >= dailyQuota) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({
        error: 'quota_exceeded',
        message: `Daily invoice quota (${dailyQuota}) reached for this merchant`,
      });
    }
  }

  const inv = store.createInvoice({
    merchant: merchant.toLowerCase() as `0x${string}`,
    amount,
    token: tokenAddr,
    invoiceType: Number(invoice_type) as any,
    expiresAt: Number(expires_at || 0),
    title,
    memo,
    metadata: typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) ? metadata : undefined,
    hash: hash as `0x${string}` | undefined,
    chainTxHash: chain_tx_hash as `0x${string}` | undefined,
  });
  void dispatchWebhook(inv, 'invoice.created');
  res.status(201).json(inv);
});

/**
 * GET /v1/invoices/:hash/messages — invoice-scoped chat transcript.
 * Merchant: API key. Payer: invoice guest token, or empty transcript before first payer message.
 */
router.get('/:hash/messages', async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireConversationAccess(req, res, inv)) return;

  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 500 });
  const messages = store.listMessages(req.params.hash, { limit, offset });
  res.json({
    count: messages.length,
    total: store.countMessages(req.params.hash),
    limit,
    offset,
    messages,
  });
});

/**
 * POST /v1/invoices/:hash/messages — send a merchant/payer/system message.
 */
router.post('/:hash/messages', async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!validateMessageInput(req, res)) return;
  if (!messageRateLimit(req, res)) return;

  const role = req.body?.sender_role;
  if (role === 'merchant' && !await requireInvoiceMerchant(req, res, inv, 'invoices:write')) {
    return;
  }

  try {
    const result = store.createMessage({
      invoiceHash: req.params.hash,
      senderRole: role,
      senderAddress: req.body?.sender_address,
      senderLabel: req.body?.sender_label,
      body: req.body?.body,
      guestToken: guestToken(req) || req.body?.guest_token,
    });
    if (!result) return res.status(404).json({ error: 'not_found' });
    if (result.message.senderRole === 'payer') {
      void dispatchWebhook(inv, 'message.created', {
        message_id: result.message.id,
        sender_role: result.message.senderRole,
        sender_label: result.message.senderLabel,
        message_preview: result.message.body.slice(0, 160),
      });
    }
    res.status(201).json({
      ok: true,
      message: result.message,
      guest_token: result.guestToken,
    });
  } catch (e: any) {
    const message = e?.message ?? 'Invalid message';
    const status = message.includes('guest token') ? 403 : 400;
    res.status(status).json({ error: status === 403 ? 'forbidden' : 'bad_request', message });
  }
});

/**
 * POST /v1/invoices/:hash/messages/:id/read — mark a message as read.
 */
router.post('/:hash/messages/:id/read', async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireConversationAccess(req, res, inv)) return;

  const message = store.markMessageRead(req.params.hash, req.params.id);
  if (!message) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, message });
});

/**
 * POST /v1/invoices/:hash/verify-payment — verify a real QIE/QUSDC transaction via RPC.
 * Body: { payer: 0x..., tx_hash: 0x... }
 */
router.post('/:hash/verify-payment', async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });

  const { payer, tx_hash } = req.body ?? {};
  if (!payer || !/^0x[a-fA-F0-9]{40}$/.test(payer)) {
    return res.status(400).json({ error: 'bad_request', message: 'payer required (0x...)' });
  }
  if (!tx_hash || !/^0x[a-fA-F0-9]{64}$/.test(tx_hash)) {
    return res.status(400).json({ error: 'bad_request', message: 'tx_hash required (0x...64 hex)' });
  }

  try {
    const isNative = inv.token.toLowerCase() === '0x0000000000000000000000000000000000000000';
    if (isNative) {
      await verifyNativePayment({
        txHash: tx_hash,
        invoiceHash: inv.hash,
        merchant: inv.merchant,
        payer: payer.toLowerCase() as `0x${string}`,
        amount: inv.amount,
      });
    } else {
      await verifyTokenPayment({
        txHash: tx_hash,
        invoiceHash: inv.hash,
        merchant: inv.merchant,
        payer: payer.toLowerCase() as `0x${string}`,
        amount: inv.amount,
      });
    }
    const updated = store.markPaid(req.params.hash, payer.toLowerCase() as `0x${string}`, tx_hash);
    if (!updated) return res.status(404).json({ error: 'not_found' });
    void dispatchWebhook(updated, 'invoice.paid');
    const receipt = store.getReceipt(updated.hash);
    if (receipt) void dispatchWebhook(updated, 'receipt.created', { receipt_hash: receipt.receiptHash });
    res.json({ ok: true, invoice: updated });
  } catch (e: any) {
    recordPaymentVerificationFailure(inv, { payer, txHash: tx_hash, error: e });
    res.status(400).json({ error: 'payment_not_verified', message: e?.message ?? 'Payment could not be verified' });
  }
});

/**
 * GET /v1/invoices/:hash/events — JSON timeline or SSE stream when requested.
 */
router.get('/:hash/events', async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireConversationAccess(req, res, inv)) return;

  if (!String(req.header('accept') ?? '').includes('text/event-stream')) {
    const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 500 });
    const merchantView = await hasInvoiceMerchantReadAccess(req, inv);
    const after = eventReplayCursor(req);
    const events = store
      .listEvents(req.params.hash, after, { limit, offset })
      .map((event) => publicInvoiceEvent(event, merchantView));
    return res.json({ count: events.length, limit, offset, events });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const merchantView = await hasInvoiceMerchantReadAccess(req, inv);
  const after = eventReplayCursor(req);
  for (const event of store.listEvents(req.params.hash, after)) {
    const safeEvent = publicInvoiceEvent(event, merchantView);
    res.write(`id: ${safeEvent.id}\nevent: ${safeEvent.type}\ndata: ${JSON.stringify(safeEvent)}\n\n`);
  }

  const off = store.onInvoiceEvent(req.params.hash, (event) => {
    const safeEvent = publicInvoiceEvent(event, merchantView);
    res.write(`id: ${safeEvent.id}\nevent: ${safeEvent.type}\ndata: ${JSON.stringify(safeEvent)}\n\n`);
  });
  req.on('close', off);
});

/**
 * POST /v1/invoices/:hash/paid — authenticated compatibility verifier.
 * Body: { payer: 0x…, tx_hash: 0x… }
 */
router.post('/:hash/paid', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  const { payer, tx_hash } = req.body ?? {};
  if (!payer || !/^0x[a-fA-F0-9]{40}$/.test(payer)) {
    return res.status(400).json({ error: 'bad_request', message: 'payer required (0x…)' });
  }
  if (!tx_hash || !/^0x[a-fA-F0-9]{64}$/.test(tx_hash)) {
    return res.status(400).json({ error: 'bad_request', message: 'tx_hash required (0x…64 hex)' });
  }

  try {
    const isNative = inv.token.toLowerCase() === '0x0000000000000000000000000000000000000000';
    if (isNative) {
      await verifyNativePayment({
        txHash: tx_hash,
        invoiceHash: inv.hash,
        merchant: inv.merchant,
        payer: payer.toLowerCase() as `0x${string}`,
        amount: inv.amount,
      });
    } else {
      await verifyTokenPayment({
        txHash: tx_hash,
        invoiceHash: inv.hash,
        merchant: inv.merchant,
        payer: payer.toLowerCase() as `0x${string}`,
        amount: inv.amount,
      });
    }
    const updated = store.markPaid(req.params.hash, payer.toLowerCase() as `0x${string}`, tx_hash);
    if (!updated) return res.status(404).json({ error: 'not_found' });
    void dispatchWebhook(updated, 'invoice.paid');
    const receipt = store.getReceipt(updated.hash);
    if (receipt) void dispatchWebhook(updated, 'receipt.created', { receipt_hash: receipt.receiptHash });
    res.json({ ok: true, invoice: updated });
  } catch (e: any) {
    recordPaymentVerificationFailure(inv, { payer, txHash: tx_hash, error: e });
    res.status(400).json({ error: 'payment_not_verified', message: e?.message ?? 'Payment could not be verified' });
  }
});

router.post('/:hash/cancel', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  res.status(410).json({
    error: 'verified_lifecycle_required',
    message: 'Cancel state is updated only after a verified Qantara cancel transaction. Use /v1/invoices/:hash/cancel/verify.',
  });
});

router.post('/:hash/cancel/verify', requireApiKey, (req: Request, res: Response) => {
  void verifyContractLifecycleAction(req, res, 'cancel');
});

/**
 * POST /v1/invoices/:hash/refund — merchant refunds a paid invoice.
 * Body: { reason?: string }
 * Note: this only marks the invoice as refunded in the database. The on-chain
 * refund tx must be issued separately once the payment contract is deployed
 * (see IMPLEMENTATION_PLAN remaining work item #4).
 */
router.post('/:hash/refund/request', async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 240) : undefined;
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!requirePayerRefundAccess(req, res, inv)) return;
  if (inv.status !== store.InvoiceStatus.Paid) {
    return res.status(400).json({ error: 'bad_state', message: 'Only Paid invoices can receive payer refund requests' });
  }
  const event = store.appendInvoiceEvent(inv.hash, 'refund.requested', { reason, requestedBy: 'payer' });
  store.createMessage({
    invoiceHash: inv.hash,
    senderRole: 'payer',
    senderLabel: 'Payer',
    body: reason ? `Refund requested: ${reason}` : 'Refund requested.',
    guestToken: guestToken(req) ?? normalizedGuestToken(req.body?.guest_token),
  });
  void dispatchWebhook(inv, 'message.created', {
    sender_role: 'payer',
    message_preview: reason ? `Refund requested: ${reason}` : 'Refund requested.',
  });
  res.status(202).json({
    ok: true,
    invoice: inv,
    event,
    message: 'Refund request recorded. Refunded status is set only after verified on-chain refund confirmation.',
  });
});

router.post('/:hash/refund', requireApiKey, async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 240) : undefined;
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  if (inv.status !== store.InvoiceStatus.Paid) {
    return res.status(400).json({ error: 'bad_state', message: 'Only Paid invoices can enter refund workflow' });
  }
  store.appendInvoiceEvent(inv.hash, 'refund.requested', { reason, requestedBy: 'merchant' });
  res.status(202).json({ ok: true, invoice: inv, message: 'Refund request recorded. Refunded status is set only after indexed on-chain confirmation.' });
});

router.post('/:hash/refund/approve', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  if (inv.status !== store.InvoiceStatus.Paid) {
    return res.status(400).json({ error: 'bad_state', message: 'Only Paid invoices can have refund approvals recorded' });
  }
  const txHash = typeof req.body?.tx_hash === 'string' ? req.body.tx_hash : undefined;
  if (txHash !== undefined && !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'bad_request', message: 'tx_hash must be a 0x-prefixed 32-byte hex string when provided' });
  }
  store.appendInvoiceEvent(inv.hash, 'refund.approved', {
    message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 240) : undefined,
    txHash,
  });
  store.createMessage({
    invoiceHash: inv.hash,
    senderRole: 'merchant',
    senderLabel: 'Merchant',
    body: typeof req.body?.message === 'string' && req.body.message.trim()
      ? `Refund approved: ${req.body.message.slice(0, 240)}`
      : 'Refund approved. Merchant will complete the verified refund transaction.',
  });
  res.json({ ok: true, invoice: inv });
});

router.post('/:hash/refund/reject', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  if (inv.status !== store.InvoiceStatus.Paid) {
    return res.status(400).json({ error: 'bad_state', message: 'Only Paid invoices can have refund rejections recorded' });
  }
  store.appendInvoiceEvent(inv.hash, 'refund.rejected', {
    message: typeof req.body?.message === 'string' ? req.body.message.slice(0, 240) : undefined,
  });
  store.createMessage({
    invoiceHash: inv.hash,
    senderRole: 'merchant',
    senderLabel: 'Merchant',
    body: typeof req.body?.message === 'string' && req.body.message.trim()
      ? `Refund rejected: ${req.body.message.slice(0, 240)}`
      : 'Refund rejected. Continue the dispute in this deal room.',
  });
  res.json({ ok: true, invoice: inv });
});

/**
 * POST /v1/invoices/:hash/dispute/open — payer opens a dispute (guest session).
 * Body: { reason?: string }. Lightweight: records a timeline event + deal-room
 * message + webhook; the merchant resolves via the dispute/resolve endpoint.
 */
router.post('/:hash/dispute/open', async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined;
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!requirePayerRefundAccess(req, res, inv)) return;
  if (inv.status !== store.InvoiceStatus.Paid) {
    return res.status(400).json({ error: 'bad_state', message: 'Only Paid invoices can be disputed' });
  }
  const event = store.appendInvoiceEvent(inv.hash, 'dispute.opened', { reason, openedBy: 'payer' });
  store.createMessage({
    invoiceHash: inv.hash,
    senderRole: 'payer',
    senderLabel: 'Payer',
    body: reason ? `Dispute opened: ${reason}` : 'Dispute opened.',
    guestToken: guestToken(req) ?? normalizedGuestToken(req.body?.guest_token),
  });
  void dispatchWebhook(inv, 'message.created', { sender_role: 'payer', message_preview: reason ? `Dispute opened: ${reason}` : 'Dispute opened.' });
  res.status(202).json({ ok: true, invoice: inv, event });
});

/**
 * POST /v1/invoices/:hash/dispute/resolve — merchant resolves a dispute.
 * Body: { resolution: 'refunded' | 'rejected' | 'resolved', message?: string }.
 */
router.post('/:hash/dispute/resolve', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  const resolution = req.body?.resolution;
  if (!['refunded', 'rejected', 'resolved'].includes(resolution)) {
    return res.status(400).json({ error: 'bad_request', message: 'resolution must be refunded|rejected|resolved' });
  }
  const note = typeof req.body?.message === 'string' ? req.body.message.slice(0, 500) : undefined;
  const event = store.appendInvoiceEvent(inv.hash, 'dispute.resolved', { resolution, message: note });
  store.createMessage({
    invoiceHash: inv.hash,
    senderRole: 'merchant',
    senderLabel: 'Merchant',
    body: note ? `Dispute ${resolution}: ${note}` : `Dispute ${resolution}.`,
  });
  void dispatchWebhook(inv, 'message.created', { sender_role: 'merchant', message_preview: `Dispute ${resolution}.` });
  res.json({ ok: true, invoice: inv, event });
});

router.post('/:hash/refund/verify', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  if (inv.status !== store.InvoiceStatus.Paid || !inv.payer) {
    return res.status(400).json({ error: 'bad_state', message: 'Only paid invoices with a payer can be refund-verified' });
  }
  const txHash = req.body?.tx_hash;
  if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'bad_request', message: 'tx_hash required (0x...64 hex)' });
  }

  try {
    const isNative = inv.token.toLowerCase() === '0x0000000000000000000000000000000000000000';
    if (isNative) {
      await verifyNativeRefund({
        txHash: txHash as `0x${string}`,
        merchant: inv.merchant,
        payer: inv.payer,
        amount: inv.amount,
      });
    } else {
      await verifyTokenRefund({
        txHash: txHash as `0x${string}`,
        merchant: inv.merchant,
        payer: inv.payer,
        amount: inv.amount,
      });
    }
    const refunded = store.refundInvoice(inv.hash, 'verified direct refund');
    if (!refunded) return res.status(404).json({ error: 'not_found' });
    store.appendInvoiceEvent(inv.hash, 'refund.verified', { txHash });
    void dispatchWebhook(refunded, 'invoice.refunded');
    res.json({ ok: true, invoice: refunded });
  } catch (err: any) {
    res.status(400).json({ error: 'refund_not_verified', message: err?.message ?? 'Refund could not be verified' });
  }
});

router.post('/:hash/refund/verify-contract', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  if (inv.status !== store.InvoiceStatus.Paid) {
    return res.status(400).json({ error: 'bad_state', message: 'Only paid invoices can be refund-verified' });
  }
  const txHash = req.body?.tx_hash;
  if (!txHash || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'bad_request', message: 'tx_hash required (0x...64 hex)' });
  }

  try {
    const verified = await verifyQantaraRefundEvent({
      txHash: txHash as `0x${string}`,
      invoiceHash: inv.hash,
      merchant: inv.merchant,
    });
    const refunded = store.refundInvoice(inv.hash, 'verified contract refund');
    if (!refunded) return res.status(404).json({ error: 'not_found' });
    store.recordChainEvent({
      contractAddress: verified.contractAddress,
      invoiceHash: inv.hash,
      eventType: verified.eventType,
      txHash: txHash as `0x${string}`,
      blockNumber: verified.blockNumber,
      logIndex: verified.logIndex,
      payload: { amount: verified.amount, verifiedBy: 'merchant-action' },
    });
    void dispatchWebhook(refunded, 'invoice.refunded');
    res.json({ ok: true, invoice: refunded, chain: verified });
  } catch (err: any) {
    res.status(400).json({ error: 'refund_not_verified', message: err?.message ?? 'Contract refund could not be verified' });
  }
});

router.post('/:hash/pause', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  res.status(410).json({
    error: 'verified_lifecycle_required',
    message: 'Pause state is updated only after a verified Qantara pause transaction. Use /v1/invoices/:hash/pause/verify.',
  });
});

router.post('/:hash/pause/verify', requireApiKey, (req: Request, res: Response) => {
  void verifyContractLifecycleAction(req, res, 'pause');
});

router.post('/:hash/resume', requireApiKey, async (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!await requireInvoiceMerchant(req, res, inv, 'invoices:write')) return;
  res.status(410).json({
    error: 'verified_lifecycle_required',
    message: 'Resume state is updated only after a verified Qantara resume transaction. Use /v1/invoices/:hash/resume/verify.',
  });
});

router.post('/:hash/resume/verify', requireApiKey, (req: Request, res: Response) => {
  void verifyContractLifecycleAction(req, res, 'resume');
});

export default router;
