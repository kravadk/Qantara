import { Router, type Request, type Response } from 'express';
import { isAddress } from 'viem';
import { verifyWebhookSignature, normalize, type Provider } from '../lib/onrampVerifier.js';
import { listOnrampOrders, upsertOnrampOrder } from '../lib/store.js';
import {
  type AuthIdentity,
  identityHasMerchantBoundary,
  validateBearerIdentity,
} from '../lib/authIdentity.js';

const router = Router();

type OnrampLocals = {
  identity: AuthIdentity;
};

async function requireOpsRead(req: Request, res: Response<any, OnrampLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'ops:read') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!identityHasMerchantBoundary(identity)) {
    return res.status(403).json({ error: 'merchant_boundary_required' });
  }
  res.locals.identity = identity;
  next();
}

router.get('/orders', requireOpsRead, (req: Request, res: Response<any, OnrampLocals>) => {
  const wallet = String(req.query.wallet ?? '');
  if (!isAddress(wallet)) return res.status(400).json({ error: 'invalid_wallet' });
  res.json({ ok: true, items: listOnrampOrders(wallet, 20) });
});

router.post('/webhook', (req: Request, res: Response) => {
  const provider = (req.query.provider as Provider) ?? 'moonpay';
  if (provider !== 'moonpay' && provider !== 'transak') {
    return res.status(400).json({ error: 'unknown_provider' });
  }
  const raw = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
  const ok = verifyWebhookSignature(provider, raw, req.headers as Record<string, string>);
  if (!ok) return res.status(401).json({ error: 'bad_signature' });

  const normalized = normalize(provider, req.body);
  if (!normalized) return res.status(400).json({ error: 'unparseable_payload' });

  upsertOnrampOrder({
    provider,
    externalId: normalized.externalId,
    walletAddr: normalized.walletAddr,
    amountFiat: normalized.amountFiat,
    currencyFiat: normalized.currencyFiat,
    amountCrypto: normalized.amountCrypto,
    currencyCrypto: normalized.currencyCrypto,
    status: normalized.status,
  });

  res.json({ ok: true });
});

export default router;
