import type { Server } from 'node:http';
import { optionalEnv } from './env.js';
import * as store from './store.js';
import { anchorReceipt, isAnchorAutoEnabled, isAnchorEnabled } from './receiptAnchor.js';
import { logger } from './logger.js';

export interface AnchorRunResult {
  enabled: boolean;
  processed: number;
  anchored: number;
  alreadyAnchored: number;
  errors: Array<{ invoiceHash: string; error: string }>;
}

/**
 * Anchor any issued-but-unanchored receipts on-chain. Safe to call repeatedly:
 * each receipt is checked against the registry first, and failures are recorded
 * (status `failed`) so a later run can retry without losing the receipt.
 */
export async function processReceiptAnchors(limit = 25): Promise<AnchorRunResult> {
  const result: AnchorRunResult = { enabled: false, processed: 0, anchored: 0, alreadyAnchored: 0, errors: [] };
  if (!isAnchorEnabled()) return result;
  result.enabled = true;

  const pending = store.listUnanchoredReceipts(limit);
  for (const receipt of pending) {
    result.processed += 1;
    try {
      const outcome = await anchorReceipt(receipt);
      store.markReceiptAnchored(receipt.invoiceHash, (outcome.txHash as `0x${string}` | null) ?? null);
      if (outcome.alreadyAnchored) {
        result.alreadyAnchored += 1;
      } else {
        result.anchored += 1;
      }
    } catch (err: any) {
      store.markReceiptAnchorFailed(receipt.invoiceHash);
      result.errors.push({ invoiceHash: receipt.invoiceHash, error: err?.message ?? 'anchor_failed' });
    }
  }
  return result;
}

export function startReceiptAnchorWorker(server: Server): void {
  if (!isAnchorAutoEnabled()) return;
  const intervalMs = Math.max(15_000, Number(optionalEnv('RECEIPT_ANCHOR_INTERVAL_MS') ?? '60000'));
  const timer = setInterval(() => {
    void processReceiptAnchors().catch((err) => {
      logger.warn('receipt_anchor_worker_failed', { message: err?.message ?? String(err) });
    });
  }, intervalMs);
  timer.unref();
  server.on('close', () => clearInterval(timer));
}
