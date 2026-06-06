import { Router, type Request, type Response } from 'express';
import type { Address } from 'viem';
import { parsePagination } from '../lib/pagination.js';
import * as eventsRepository from '../repositories/eventsRepository.js';
import * as invoicesRepository from '../repositories/invoicesRepository.js';
import * as merchantsRepository from '../repositories/merchantsRepository.js';
import * as messagesRepository from '../repositories/messagesRepository.js';
import * as receiptsRepository from '../repositories/receiptsRepository.js';

const router = Router();

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const STATUS_BY_NAME: Record<string, invoicesRepository.InvoiceStatusValue> = {
  open: invoicesRepository.InvoiceStatus.Created,
  created: invoicesRepository.InvoiceStatus.Created,
  paid: invoicesRepository.InvoiceStatus.Paid,
  cancelled: invoicesRepository.InvoiceStatus.Cancelled,
  canceled: invoicesRepository.InvoiceStatus.Cancelled,
  refunded: invoicesRepository.InvoiceStatus.Refunded,
  paused: invoicesRepository.InvoiceStatus.Paused,
};

function publicMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const denied = /(secret|api[_-]?key|authorization|bearer|guest[_-]?token|webhook|delivery|internal|target[_-]?url)/i;
  const clean = Object.entries(metadata).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (denied.test(key)) return acc;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = publicMetadata(value as Record<string, unknown>);
      if (nested && Object.keys(nested).length > 0) acc[key] = nested;
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function statusName(status: invoicesRepository.InvoiceStatusValue): string {
  if (status === invoicesRepository.InvoiceStatus.Paid) return 'paid';
  if (status === invoicesRepository.InvoiceStatus.Cancelled) return 'cancelled';
  if (status === invoicesRepository.InvoiceStatus.Refunded) return 'refunded';
  if (status === invoicesRepository.InvoiceStatus.Paused) return 'paused';
  return 'open';
}

function tokenFilter(value: unknown): Address | undefined | false {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const token = value.trim();
  if (token.toUpperCase() === 'QIE') return ZERO_ADDRESS as Address;
  if (token.toUpperCase() === 'QUSDC') {
    const qusdc = process.env.QUSDC_ADDRESS;
    return qusdc && ADDRESS_RE.test(qusdc) ? qusdc.toLowerCase() as Address : false;
  }
  return ADDRESS_RE.test(token) ? token.toLowerCase() as Address : false;
}

function statusFilter(value: unknown): invoicesRepository.InvoiceStatusValue | undefined | false {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized in STATUS_BY_NAME) return STATUS_BY_NAME[normalized];
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && Object.values(invoicesRepository.InvoiceStatus).includes(numeric as invoicesRepository.InvoiceStatusValue)) {
    return numeric as invoicesRepository.InvoiceStatusValue;
  }
  return false;
}

function publicEvent(event: eventsRepository.InvoiceEvent) {
  return {
    id: event.id,
    type: event.type,
    invoiceHash: event.invoiceHash,
    payload: publicMetadata(event.payload) ?? {},
    createdAt: event.createdAt,
  };
}

function publicReceipt(receipt: receiptsRepository.Receipt | undefined) {
  if (!receipt) return undefined;
  return {
    id: receipt.id,
    invoiceHash: receipt.invoiceHash,
    txHash: receipt.txHash,
    payer: receipt.payer,
    merchant: receipt.merchant,
    amount: receipt.amount,
    token: receipt.token,
    issuedAt: receipt.issuedAt,
    receiptHash: receipt.receiptHash,
  };
}

function activityItem(inv: invoicesRepository.Invoice) {
  const events = eventsRepository.listEvents(inv.hash, undefined, { limit: 25 });
  const latestEvent = events[events.length - 1];
  const receipt = receiptsRepository.getReceipt(inv.hash);
  const messageCount = messagesRepository.countMessages(inv.hash);

  return {
    invoice: {
      hash: inv.hash,
      merchant: inv.merchant,
      payer: inv.payer,
      token: inv.token,
      amount: inv.amount,
      invoiceType: inv.invoiceType,
      status: inv.status,
      statusName: statusName(inv.status),
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt || null,
      title: inv.title,
      memo: inv.memo,
      paidAt: inv.paidAt,
      paidTxHash: inv.paidTxHash,
      metadata: publicMetadata(inv.metadata),
      hasReceipt: !!receipt,
      messageCount,
    },
    latestEvent: latestEvent ? publicEvent(latestEvent) : null,
    recentEvents: events.slice(-10).map(publicEvent),
    receipt: publicReceipt(receipt) ?? null,
  };
}

router.get('/activity', (req: Request, res: Response) => {
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, defaultLimit: 25, maxLimit: 100 });
  const merchant = typeof req.query.merchant === 'string' && ADDRESS_RE.test(req.query.merchant)
    ? req.query.merchant.toLowerCase() as Address
    : undefined;
  const payer = typeof req.query.payer === 'string' && ADDRESS_RE.test(req.query.payer)
    ? req.query.payer.toLowerCase() as Address
    : undefined;
  const invoiceHash = typeof req.query.invoice_hash === 'string'
    ? req.query.invoice_hash
    : typeof req.query.invoiceHash === 'string'
      ? req.query.invoiceHash
      : undefined;
  const parsedStatus = statusFilter(req.query.status);
  if (parsedStatus === false) {
    return res.status(400).json({ error: 'bad_request', message: 'status must be open, paid, cancelled, refunded, paused, or a known numeric status' });
  }
  const parsedToken = tokenFilter(req.query.token);
  if (parsedToken === false) {
    return res.status(400).json({ error: 'bad_request', message: 'token must be QIE, QUSDC, or a 0x token address configured on QIE' });
  }

  const result = invoicesRepository.listInvoices({
    invoiceHash,
    merchant,
    payer,
    token: parsedToken || undefined,
    status: parsedStatus,
    limit,
    offset,
  });

  res.json({
    source: 'sqlite',
    count: result.invoices.length,
    total: result.total,
    limit,
    offset,
    filters: {
      merchant,
      payer,
      invoiceHash,
      status: parsedStatus,
      token: parsedToken || undefined,
    },
    activity: result.invoices.map(activityItem),
  });
});

// GET /v1/explorer/stats — public network aggregate (volume, active merchants, receipts, 24h).
router.get('/stats', (_req: Request, res: Response) => {
  res.json({ ...merchantsRepository.explorerStats(), source: 'backend' });
});

// GET /v1/explorer/merchants — public directory of merchants that opted in to listing.
router.get('/merchants', (req: Request, res: Response) => {
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 200 });
  const { merchants, total } = merchantsRepository.listPublicMerchants({ limit, offset });
  res.json({
    count: merchants.length,
    total,
    limit,
    offset,
    merchants: merchants.map((m) => ({
      merchant: m.merchant,
      displayName: m.displayName ?? null,
      website: m.website ?? null,
      trust: {
        walletVerified: m.walletVerified,
        domainVerified: !!m.domainVerifiedAt,
        domain: m.domainVerifiedAt ? m.domain ?? null : null,
      },
    })),
    source: 'backend',
  });
});

export default router;
