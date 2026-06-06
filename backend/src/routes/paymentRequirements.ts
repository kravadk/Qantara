import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { buildPaymentRequirement } from '../lib/paymentRequirements.js';

const router = Router();

router.get('/:hash', (req: Request, res: Response) => {
  const inv = store.getInvoice(req.params.hash);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  try {
    res.json(buildPaymentRequirement(inv));
  } catch (err: any) {
    res.status(503).json({
      error: 'payment_requirement_unavailable',
      message: err?.message ?? 'Payment requirement could not be signed',
    });
  }
});

export default router;
