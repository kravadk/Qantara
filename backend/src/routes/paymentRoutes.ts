import { Router } from 'express';
import * as store from '../lib/store.js';
import { buildPaymentRoutePlan } from '../lib/paymentRoutes.js';

const router = Router();

router.get('/:hash', async (req, res) => {
  const invoice = store.getInvoice(req.params.hash);
  if (!invoice) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  res.json(await buildPaymentRoutePlan(invoice));
});

export default router;
