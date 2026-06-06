import { Router } from 'express';
import { qusdcCapabilities, railCatalog } from '../lib/rails.js';

const router = Router();

router.get('/', async (_req, res) => {
  res.json(await railCatalog());
});

router.get('/status', async (_req, res) => {
  res.json(await railCatalog());
});

router.get('/qusdc/capabilities', async (_req, res) => {
  res.json(await qusdcCapabilities());
});

export default router;
