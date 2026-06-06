import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { type AuthIdentity, identityCanAccessMerchant, identityHasMerchantBoundary, validateBearerIdentity } from '../lib/authIdentity.js';
import { parsePagination } from '../lib/pagination.js';

const router = Router();

type NotificationLocals = { apiKeyIdentity: AuthIdentity };

function requireApiKey(requiredScope: 'notifications:read' | 'notifications:write') {
  return async (req: Request, res: Response<any, NotificationLocals>, next: () => void) => {
    const auth = req.header('Authorization') ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    const identity = m ? await validateBearerIdentity(m[1], requiredScope) : undefined;
    if (!identity) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!identityHasMerchantBoundary(identity)) {
      return res.status(403).json({ error: 'merchant_boundary_required' });
    }
    res.locals.apiKeyIdentity = identity;
    next();
  };
}

function merchantFromQuery(req: Request, res: Response): `0x${string}` | undefined {
  const identity = res.locals.apiKeyIdentity;
  const merchant = typeof req.query.merchant === 'string' ? req.query.merchant : identity.merchant;
  if (!merchant || !/^0x[a-fA-F0-9]{40}$/.test(merchant)) {
    res.status(400).json({ error: 'bad_request', message: 'merchant must be a 0x address' });
    return undefined;
  }
  return merchant.toLowerCase() as `0x${string}`;
}

router.get('/', requireApiKey('notifications:read'), (req: Request, res: Response) => {
  const merchant = merchantFromQuery(req, res);
  if (!merchant) return;
  if (!identityCanAccessMerchant(res.locals.apiKeyIdentity, merchant)) {
    return res.status(403).json({ error: 'merchant_scope_mismatch' });
  }
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 200 });
  const result = store.listNotifications({ merchant, limit, offset });
  res.json({
    count: result.notifications.length,
    total: result.total,
    limit,
    offset,
    notifications: result.notifications,
  });
});

router.post('/:id/read', requireApiKey('notifications:write'), (req: Request, res: Response) => {
  const merchant = typeof req.body?.merchant === 'string' && /^0x[a-fA-F0-9]{40}$/.test(req.body.merchant)
    ? req.body.merchant.toLowerCase() as `0x${string}`
    : undefined;
  if (!merchant) return res.status(400).json({ error: 'bad_request', message: 'merchant must be a 0x address' });
  if (!identityCanAccessMerchant(res.locals.apiKeyIdentity, merchant)) {
    return res.status(403).json({ error: 'merchant_scope_mismatch' });
  }
  if (!store.setNotificationRead(merchant, req.params.id, true)) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json({ ok: true });
});

router.post('/read-all', requireApiKey('notifications:write'), (req: Request, res: Response) => {
  const merchant = typeof req.body?.merchant === 'string' && /^0x[a-fA-F0-9]{40}$/.test(req.body.merchant)
    ? req.body.merchant.toLowerCase() as `0x${string}`
    : undefined;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown): id is string => typeof id === 'string') : [];
  if (!merchant) return res.status(400).json({ error: 'bad_request', message: 'merchant must be a 0x address' });
  if (!identityCanAccessMerchant(res.locals.apiKeyIdentity, merchant)) {
    return res.status(403).json({ error: 'merchant_scope_mismatch' });
  }
  let count = 0;
  for (const id of ids.slice(0, 500)) {
    if (store.setNotificationRead(merchant, id, true)) count += 1;
  }
  res.json({ ok: true, count });
});

router.post('/:id/dismiss', requireApiKey('notifications:write'), (req: Request, res: Response) => {
  const merchant = typeof req.body?.merchant === 'string' && /^0x[a-fA-F0-9]{40}$/.test(req.body.merchant)
    ? req.body.merchant.toLowerCase() as `0x${string}`
    : undefined;
  if (!merchant) return res.status(400).json({ error: 'bad_request', message: 'merchant must be a 0x address' });
  if (!identityCanAccessMerchant(res.locals.apiKeyIdentity, merchant)) {
    return res.status(403).json({ error: 'merchant_scope_mismatch' });
  }
  if (!store.dismissNotification(merchant, req.params.id)) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json({ ok: true });
});

export default router;
