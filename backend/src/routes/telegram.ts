import { Router, type Request, type Response } from 'express';
import {
  type AuthIdentity,
  identityCanAccessMerchant,
  validateBearerIdentity,
} from '../lib/authIdentity.js';
import { parsePagination } from '../lib/pagination.js';
import * as store from '../lib/store.js';

const router = Router();
const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{1,20}$/;
const TELEGRAM_USER_ID_PATTERN = /^\d{1,20}$/;
const INVOICE_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

async function requireApiKey(req: Request, res: Response, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const id = m ? await validateBearerIdentity(m[1], 'telegram:write') : undefined;
  if (!id) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  (req as Request & { apiKeyIdentity?: AuthIdentity }).apiKeyIdentity = id;
  next();
}

function identity(req: Request): AuthIdentity {
  return (req as Request & { apiKeyIdentity: AuthIdentity }).apiKeyIdentity;
}

function callerMerchant(req: Request): `0x${string}` | undefined {
  const id = identity(req);
  return id.kind === 'stored' || id.kind === 'session' ? id.merchant : undefined;
}

function canAccessInvoice(req: Request, invoiceHash: string): boolean {
  const inv = store.getInvoice(invoiceHash);
  return !!inv && identityCanAccessMerchant(identity(req), inv.merchant);
}

router.post('/links', requireApiKey, (req: Request, res: Response) => {
  const invoiceHash = typeof req.body?.invoice_hash === 'string' ? req.body.invoice_hash : '';
  const chatId = typeof req.body?.chat_id === 'string' || typeof req.body?.chat_id === 'number'
    ? String(req.body.chat_id)
    : '';
  const creatorId = typeof req.body?.creator_id === 'string' || typeof req.body?.creator_id === 'number'
    ? String(req.body.creator_id)
    : undefined;
  if (!invoiceHash) return res.status(400).json({ error: 'bad_request', message: 'invoice_hash is required' });
  if (!chatId) return res.status(400).json({ error: 'bad_request', message: 'chat_id is required' });
  if (!INVOICE_HASH_PATTERN.test(invoiceHash)) {
    return res.status(400).json({ error: 'bad_request', message: 'invoice_hash must be a 0x-prefixed 32-byte hash' });
  }
  if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId.trim())) {
    return res.status(400).json({ error: 'bad_request', message: 'chat_id must be a Telegram numeric chat id' });
  }
  if (creatorId !== undefined && !TELEGRAM_USER_ID_PATTERN.test(creatorId.trim())) {
    return res.status(400).json({ error: 'bad_request', message: 'creator_id must be a Telegram numeric user id' });
  }
  const inv = store.getInvoice(invoiceHash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  if (!identityCanAccessMerchant(identity(req), inv.merchant)) {
    return res.status(403).json({ error: 'merchant_scope_mismatch' });
  }
  try {
    const link = store.saveTelegramLink({ invoiceHash, chatId, creatorId });
    return res.status(201).json({ ok: true, link });
  } catch (err: any) {
    return res.status(400).json({ error: 'bad_request', message: err?.message ?? 'Could not save Telegram link' });
  }
});

router.get('/links', requireApiKey, (req: Request, res: Response) => {
  const chatId = typeof req.query.chat_id === 'string' ? req.query.chat_id : undefined;
  if (chatId !== undefined && !TELEGRAM_CHAT_ID_PATTERN.test(chatId.trim())) {
    return res.status(400).json({ error: 'bad_request', message: 'chat_id must be a Telegram numeric chat id' });
  }
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 200 });
  const { links } = store.listTelegramLinks({ chatId: chatId?.trim(), limit, offset });
  const visible = links.filter((link) => canAccessInvoice(req, link.invoiceHash));
  res.json({ count: visible.length, total: visible.length, limit, offset, links: visible });
});

router.get('/links/:hash', requireApiKey, (req: Request, res: Response) => {
  if (!INVOICE_HASH_PATTERN.test(req.params.hash)) {
    return res.status(400).json({ error: 'bad_request', message: 'hash must be a 0x-prefixed 32-byte hash' });
  }
  const link = store.getTelegramLink(req.params.hash);
  if (!link) return res.status(404).json({ error: 'not_found' });
  if (!canAccessInvoice(req, link.invoiceHash)) {
    return res.status(403).json({ error: 'merchant_scope_mismatch' });
  }
  res.json({ link });
});

// Per-merchant default Telegram chat — self-serve, so each merchant routes its own
// notifications to its own chat instead of relying on a single shared operator chat.
router.get('/merchant', requireApiKey, (req: Request, res: Response) => {
  const merchant = callerMerchant(req);
  if (!merchant) {
    return res.status(403).json({ error: 'merchant_boundary_required', message: 'A merchant wallet session or merchant-scoped API key is required' });
  }
  const link = store.getMerchantTelegramChat(merchant);
  res.json({ merchant, link: link ?? null });
});

router.put('/merchant', requireApiKey, (req: Request, res: Response) => {
  const merchant = callerMerchant(req);
  if (!merchant) {
    return res.status(403).json({ error: 'merchant_boundary_required', message: 'A merchant wallet session or merchant-scoped API key is required' });
  }
  const chatId = typeof req.body?.chat_id === 'string' || typeof req.body?.chat_id === 'number' ? String(req.body.chat_id).trim() : '';
  const creatorId = typeof req.body?.creator_id === 'string' || typeof req.body?.creator_id === 'number' ? String(req.body.creator_id).trim() : undefined;
  if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId)) {
    return res.status(400).json({ error: 'bad_request', message: 'chat_id must be a Telegram numeric chat id' });
  }
  if (creatorId !== undefined && !TELEGRAM_USER_ID_PATTERN.test(creatorId)) {
    return res.status(400).json({ error: 'bad_request', message: 'creator_id must be a Telegram numeric user id' });
  }
  const link = store.setMerchantTelegramChat({ merchant, chatId, creatorId });
  res.json({ ok: true, merchant, link });
});

router.delete('/merchant', requireApiKey, (req: Request, res: Response) => {
  const merchant = callerMerchant(req);
  if (!merchant) {
    return res.status(403).json({ error: 'merchant_boundary_required', message: 'A merchant wallet session or merchant-scoped API key is required' });
  }
  const removed = store.deleteMerchantTelegramChat(merchant);
  res.json({ ok: true, removed });
});

export default router;
