import { Router, type Request, type Response } from 'express';
import { validateConfiguredOrStoredApiKeyIdentity } from '../lib/env.js';
import { dispatchOperationalAlerts } from '../lib/alerts.js';
import * as store from '../lib/store.js';

const router = Router();

function requireApiKey(req: Request, res: Response, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? validateConfiguredOrStoredApiKeyIdentity(m[1], 'ops:alerts') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (identity.kind !== 'operator') {
    return res.status(403).json({
      error: 'operator_required',
      message: 'Operational alert dispatch and delivery state require the operator API key',
    });
  }
  next();
}

router.get('/deliveries', requireApiKey, (_req, res) => {
  res.json({ deliveries: store.listOperationalAlertDeliveries() });
});

router.post('/dispatch', requireApiKey, async (_req, res) => {
  const result = await dispatchOperationalAlerts();
  res.json(result);
});

export default router;
