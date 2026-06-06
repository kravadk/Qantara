import { Router, type Request, type Response } from 'express';
import * as store from '../lib/store.js';
import { rpcStatus, syncQantaraContractEvents } from '../lib/chain.js';
import {
  optionalEnv,
  type ApiKeyIdentity,
  validateConfiguredOrStoredApiKeyIdentity,
} from '../lib/env.js';
import { type AuthIdentity, identityCanAccessMerchant, identityHasMerchantBoundary, validateBearerIdentity } from '../lib/authIdentity.js';
import { indexerRuntimeStatus } from '../lib/indexer.js';
import { parsePagination } from '../lib/pagination.js';
import { indexerSafetySettings } from '../lib/operations.js';

const router = Router();

function configuredQantaraAddress(): `0x${string}` | undefined {
  const value = optionalEnv('QANTARA_ADDRESS');
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value as `0x${string}` : undefined;
}

type ChainLocals = {
  apiKeyIdentity: AuthIdentity;
};

function requireApiKey(scope: 'chain:read' | 'chain:sync') {
  return async (req: Request, res: Response<any, ChainLocals>, next: () => void) => {
    const auth = req.header('Authorization') ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    const identity = m
      ? scope === 'chain:sync'
        ? validateConfiguredOrStoredApiKeyIdentity(m[1], scope)
        : await validateBearerIdentity(m[1], scope)
      : undefined;
    if (!identity) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.locals.apiKeyIdentity = identity;
    next();
  };
}

function requireMerchantBoundary(res: Response<any, ChainLocals>): boolean {
  if (identityHasMerchantBoundary(res.locals.apiKeyIdentity)) return true;
  res.status(403).json({
    error: 'merchant_boundary_required',
    message: 'Stored API keys without a merchant boundary cannot access chain resources',
  });
  return false;
}

router.get('/status', requireApiKey('chain:read'), async (_req: Request, res: Response<any, ChainLocals>) => {
  if (!requireMerchantBoundary(res)) return;
  const contractAddress = configuredQantaraAddress();
  const merchant = res.locals.apiKeyIdentity.kind === 'stored' || res.locals.apiKeyIdentity.kind === 'session' ? res.locals.apiKeyIdentity.merchant : undefined;
  res.json({
    rpc: await rpcStatus(),
    contractAddress,
    cursors: store.chainSyncStatus(contractAddress),
    runtime: indexerRuntimeStatus(),
    safety: indexerSafetySettings(),
    indexedEvents: store.listChainEvents({ merchant, limit: 10 }),
  });
});

router.post('/sync', requireApiKey('chain:sync'), async (req: Request, res: Response<any, ChainLocals>) => {
  if (res.locals.apiKeyIdentity.kind !== 'operator') {
    return res.status(403).json({
      error: 'operator_required',
      message: 'Chain sync requires the operator API key',
    });
  }
  const contractAddress = (
    typeof req.body?.contract_address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(req.body.contract_address)
      ? req.body.contract_address
      : configuredQantaraAddress()
  ) as `0x${string}` | undefined;
  if (!contractAddress) {
    return res.status(503).json({ error: 'contract_not_configured', message: 'QANTARA_ADDRESS is required for chain indexing' });
  }

  try {
    const result = await syncQantaraContractEvents({
      contractAddress,
      fromBlock: typeof req.body?.from_block === 'number' ? BigInt(req.body.from_block) : undefined,
      toBlock: typeof req.body?.to_block === 'number' ? BigInt(req.body.to_block) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: 'chain_sync_failed', message: err?.message ?? 'RPC sync failed' });
  }
});

router.get('/events', requireApiKey('chain:read'), (req: Request, res: Response<any, ChainLocals>) => {
  if (!requireMerchantBoundary(res)) return;
  const invoiceHash = typeof req.query.invoice_hash === 'string' ? req.query.invoice_hash : undefined;
  const merchant = res.locals.apiKeyIdentity.kind === 'stored' || res.locals.apiKeyIdentity.kind === 'session' ? res.locals.apiKeyIdentity.merchant : undefined;
  if (invoiceHash) {
    const inv = store.getInvoice(invoiceHash);
    if (!inv) return res.status(404).json({ error: 'not_found' });
    if (!identityCanAccessMerchant(res.locals.apiKeyIdentity, inv.merchant)) {
      return res.status(403).json({ error: 'merchant_scope_mismatch' });
    }
  }
  const { limit, offset } = parsePagination({ limit: req.query.limit, offset: req.query.offset, maxLimit: 200 });
  const events = store.listChainEvents({ invoiceHash, merchant, limit, offset });
  res.json({
    count: events.length,
    total: store.countChainEvents({ invoiceHash, merchant }),
    limit,
    offset,
    events,
  });
});

export default router;
