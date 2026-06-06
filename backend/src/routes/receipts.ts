import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { type AuthIdentity, identityCanAccessMerchant, identityHasMerchantBoundary, validateBearerIdentity } from '../lib/authIdentity.js';
import { parsePagination } from '../lib/pagination.js';
import { optionalEnv } from '../lib/env.js';
import { anchorReceipt, isAnchorEnabled } from '../lib/receiptAnchor.js';

const router = Router();

type ReceiptLocals = {
  apiKeyIdentity: AuthIdentity;
};

function receiptVerification(receipt?: store.Receipt) {
  const registryAddress = optionalEnv('QANTARA_RECEIPT_REGISTRY_ADDRESS') ?? null;
  const anchored = Boolean(receipt?.anchoredAt) || receipt?.anchorStatus === 'anchored';
  let status: string;
  if (anchored) {
    status = 'anchored';
  } else if (registryAddress) {
    status = receipt?.anchorStatus === 'failed' ? 'anchor_failed' : 'registry_configured_anchor_not_indexed';
  } else {
    status = 'not_configured';
  }
  return {
    source: 'backend_sqlite_rpc_verified',
    policy: 'issued_after_verified_payment',
    anchored,
    onChainAnchor: {
      enabled: Boolean(registryAddress),
      configured: Boolean(registryAddress),
      // `ready` requires both a registry address AND an anchoring signer key.
      ready: isAnchorEnabled(),
      registryAddress,
      status,
      mode: registryAddress ? 'optional_receipt_registry' : 'backend_receipt_only',
      anchorTxHash: receipt?.anchorTxHash ?? null,
      anchoredAt: receipt?.anchoredAt ?? null,
      anchorStatus: receipt?.anchorStatus ?? null,
    },
    receiptHash: receipt?.receiptHash ?? null,
    txHash: receipt?.txHash ?? null,
  };
}

function publicReceipt(receipt: store.Receipt) {
  return {
    ...receipt,
    verification: receiptVerification(receipt),
  };
}

async function requireReceiptRead(req: Request, res: Response<any, ReceiptLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'receipts:read') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.locals.apiKeyIdentity = identity;
  next();
}

router.get('/', requireReceiptRead, (req: Request, res: Response<any, ReceiptLocals>) => {
  let merchant = typeof req.query.merchant === 'string' && /^0x[a-fA-F0-9]{40}$/.test(req.query.merchant)
    ? req.query.merchant.toLowerCase() as `0x${string}`
    : undefined;
  const identity = res.locals.apiKeyIdentity;
  if (!identityHasMerchantBoundary(identity)) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot list receipts',
    });
  }
  if (identity.kind === 'stored' || identity.kind === 'session') {
    if (merchant && !identityCanAccessMerchant(identity, merchant)) {
      return res.status(403).json({
        error: 'merchant_scope_mismatch',
        message: 'Stored merchant API keys can only list receipts for their own merchant',
      });
    }
    merchant = identity.merchant;
  }
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 200 });
  const result = store.listReceipts({ merchant, limit, offset });
  res.json({ count: result.receipts.length, total: result.total, limit, offset, receipts: result.receipts.map(publicReceipt) });
});

router.get('/status', (_req: Request, res: Response) => {
  const result = store.listReceipts({ limit: 1 });
  res.json({
    ok: true,
    source: 'sqlite',
    receipts: {
      total: result.total,
      issued: result.total,
    },
    verification: receiptVerification(),
  });
});

router.get('/:hash', (req: Request, res: Response) => {
  const receipt = store.getReceipt(req.params.hash);
  if (!receipt) return res.status(404).json({ error: 'not_found' });
  res.json(publicReceipt(receipt));
});

async function requireReceiptWrite(req: Request, res: Response<any, ReceiptLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'invoices:write') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.locals.apiKeyIdentity = identity;
  next();
}

// On-demand on-chain anchoring of an already-issued receipt. Anchoring never
// affects paid/refunded state; it only mirrors the receipt hash into the
// optional QantaraReceiptRegistry for auditability.
router.post('/:hash/anchor', requireReceiptWrite, async (req: Request, res: Response<any, ReceiptLocals>) => {
  const receipt = store.getReceipt(req.params.hash);
  if (!receipt) return res.status(404).json({ error: 'not_found' });

  const identity = res.locals.apiKeyIdentity;
  if (!identityHasMerchantBoundary(identity)) {
    return res.status(403).json({
      error: 'merchant_boundary_required',
      message: 'Stored API keys without a merchant boundary cannot anchor receipts',
    });
  }
  if (identity.kind !== 'operator' && !identityCanAccessMerchant(identity, receipt.merchant)) {
    return res.status(403).json({
      error: 'merchant_scope_mismatch',
      message: 'Merchant-scoped credentials can only anchor their own receipts',
    });
  }

  if (!isAnchorEnabled()) {
    return res.status(412).json({
      error: 'anchoring_not_configured',
      message: 'On-chain anchoring requires QANTARA_RECEIPT_REGISTRY_ADDRESS and an anchoring signer key (RECEIPT_ANCHOR_PK or RELAYER_PK)',
    });
  }
  if (receipt.anchoredAt || receipt.anchorStatus === 'anchored') {
    return res.status(409).json({ error: 'already_anchored', receipt: publicReceipt(receipt) });
  }

  try {
    const outcome = await anchorReceipt(receipt);
    const updated = store.markReceiptAnchored(receipt.invoiceHash, (outcome.txHash as `0x${string}` | null) ?? null);
    return res.json({
      ok: true,
      alreadyAnchored: outcome.alreadyAnchored,
      txHash: outcome.txHash,
      receipt: publicReceipt(updated ?? receipt),
    });
  } catch (err: any) {
    store.markReceiptAnchorFailed(receipt.invoiceHash);
    return res.status(502).json({ error: 'anchor_failed', message: err?.message ?? 'anchor_failed' });
  }
});

export default router;
