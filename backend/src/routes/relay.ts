import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  sponsorForwardRequest,
  getRelayerStatus,
  decodeSelector,
  type ForwardRequestInput,
} from '../lib/relayerSigner.js';
import { countRelaysToday, logRelay, recentRelays } from '../lib/store.js';
import {
  apiKeyHasMerchantBoundary,
  optionalEnv,
  validateConfiguredOrStoredApiKeyIdentity,
} from '../lib/env.js';

const router = Router();

const MAX_TX_PER_ADDR_PER_DAY = Number(optionalEnv('RELAYER_MAX_TX_PER_ADDR_PER_DAY') ?? '20');
const MAX_VALUE_PER_TX_QIE = Number(optionalEnv('RELAYER_MAX_VALUE_PER_TX_QIE') ?? '0.1');
const MAX_VALUE_PER_TX_WEI = BigInt(Math.floor(MAX_VALUE_PER_TX_QIE * 1e18));

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

function publicRelayError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (message === 'verify_failed_offchain') return 'forward_request_not_verified';
  if (message === 'relay_tx_reverted') return 'relay_transaction_reverted';
  return 'relay_unavailable';
}

router.get('/status', requireOpsRead, async (_req, res) => {
  const status = await getRelayerStatus();
  res.json(status);
});

router.get('/recent', requireOpsRead, (_req, res) => {
  res.json({ ok: true, items: recentRelays(20) });
});

router.post('/sponsor', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const fr = body.forwardRequest as ForwardRequestInput | undefined;
  const signature = String(body.signature ?? '');
  if (!fr || !signature) return res.status(400).json({ error: 'missing_forward_request' });

  for (const k of ['from', 'to', 'value', 'gas', 'nonce', 'deadline', 'data'] as const) {
    if ((fr as any)[k] === undefined) return res.status(400).json({ error: `missing_field:${k}` });
  }

  let valueWei: bigint;
  try {
    valueWei = BigInt(fr.value);
  } catch {
    return res.status(400).json({ error: 'invalid_value' });
  }
  if (valueWei > MAX_VALUE_PER_TX_WEI) {
    return res.status(429).json({ error: 'value_cap_exceeded', maxQie: MAX_VALUE_PER_TX_QIE });
  }

  const count = countRelaysToday(fr.from);
  if (count >= MAX_TX_PER_ADDR_PER_DAY) {
    return res.status(429).json({ error: 'rate_limit', cap: MAX_TX_PER_ADDR_PER_DAY, used: count });
  }

  try {
    const { txHash, receipt } = await sponsorForwardRequest(fr, signature);
    logRelay({
      id: randomUUID(),
      fromAddr: fr.from,
      target: fr.to,
      selector: decodeSelector(fr.data),
      txHash,
      value: fr.value,
      gasUsed: receipt.gasUsed.toString(),
    });
    res.json({ ok: true, txHash, gasUsed: receipt.gasUsed.toString() });
  } catch (e: any) {
    res.status(500).json({ error: 'relay_failed', reason: publicRelayError(e) });
  }
});

export default router;
