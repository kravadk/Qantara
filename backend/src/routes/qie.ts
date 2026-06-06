import { Router } from 'express';
import { qieEcosystemLinks, qieLendingStatus, qieNetworkCatalog } from '../lib/qieEcosystem.js';

const router = Router();

router.get('/network-catalog', (_req, res) => {
  res.json(qieNetworkCatalog());
});

router.get('/ecosystem', (_req, res) => {
  res.json(qieEcosystemLinks());
});

router.get('/lending/status', async (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address : undefined;
  res.json(await qieLendingStatus(address));
});

export default router;
