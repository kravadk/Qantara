import { Router, type Request, type Response } from 'express';
import {
  apiKeyHasMerchantBoundary,
  validateConfiguredOrStoredApiKeyIdentity,
} from '../lib/env.js';
import { deploymentRegistryStatus } from '../lib/deployments.js';

const router = Router();

function requireOpsRead(req: Request, res: Response, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? validateConfiguredOrStoredApiKeyIdentity(m[1], 'ops:read') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!apiKeyHasMerchantBoundary(identity)) {
    return res.status(403).json({ error: 'merchant_boundary_required' });
  }
  next();
}

router.get('/status', requireOpsRead, (_req, res) => {
  res.json(deploymentRegistryStatus());
});

export default router;
