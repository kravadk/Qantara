import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { type AuthIdentity, validateBearerIdentity } from '../lib/authIdentity.js';

const router = Router();

type BillingLocals = { identity: AuthIdentity };

async function requireMerchant(req: Request, res: Response<any, BillingLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'invoices:read') : undefined;
  if (!identity) return res.status(401).json({ error: 'unauthorized' });
  res.locals.identity = identity;
  next();
}

// GET /v1/billing/summary — per-merchant invoice counts + paid volume by token.
// Scoped to the caller's own merchant (session or merchant API key).
router.get('/summary', requireMerchant, (_req: Request, res: Response<any, BillingLocals>) => {
  const identity = res.locals.identity;
  const merchant = identity.kind === 'stored' || identity.kind === 'session' ? identity.merchant : undefined;
  if (!merchant) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'A merchant wallet session or merchant-scoped API key is required for billing',
    });
  }
  res.json(store.billingSummary(merchant));
});

function merchantOf(res: Response<any, BillingLocals>) {
  const id = res.locals.identity;
  return id.kind === 'stored' || id.kind === 'session' ? id.merchant : undefined;
}

// GET /v1/billing/analytics — conversion, average time-to-pay, webhook failure rate.
router.get('/analytics', requireMerchant, (_req: Request, res: Response<any, BillingLocals>) => {
  const merchant = merchantOf(res);
  if (!merchant) return res.status(403).json({ error: 'merchant_boundary_required' });
  res.json({ merchant, ...store.merchantAnalytics(merchant) });
});

// GET /v1/billing/customers — distinct payers (customers list).
router.get('/customers', requireMerchant, (_req: Request, res: Response<any, BillingLocals>) => {
  const merchant = merchantOf(res);
  if (!merchant) return res.status(403).json({ error: 'merchant_boundary_required' });
  const customers = store.listMerchantPayers(merchant);
  res.json({ count: customers.length, customers });
});

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /v1/billing/receipts.csv — settlement export (tax-ready receipt ledger).
router.get('/receipts.csv', requireMerchant, (_req: Request, res: Response<any, BillingLocals>) => {
  const merchant = merchantOf(res);
  if (!merchant) return res.status(403).json({ error: 'merchant_boundary_required' });
  const { receipts } = store.listReceipts({ merchant, limit: 1000 });
  const header = ['id', 'invoiceHash', 'txHash', 'payer', 'merchant', 'amount', 'token', 'issuedAtIso', 'receiptHash'];
  const lines = [header.join(',')];
  for (const r of receipts) {
    lines.push([
      r.id,
      r.invoiceHash,
      r.txHash,
      r.payer,
      r.merchant,
      r.amount,
      r.token,
      new Date(r.issuedAt * 1000).toISOString(),
      r.receiptHash,
    ].map(csvCell).join(','));
  }
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="qantara-receipts.csv"');
  res.send(lines.join('\n'));
});

export default router;
