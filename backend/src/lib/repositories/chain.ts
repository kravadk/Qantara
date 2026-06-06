import { type Address } from 'viem';

import { db, nowSeconds } from '../db.js';
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  InvoiceStatus,
  markPaid,
  pauseInvoice,
  refundInvoice,
  resumeInvoice,
  type Invoice,
  type InvoiceTypeValue,
} from './invoices.js';

export interface ChainEvent {
  id: string;
  contractAddress: Address;
  invoiceHash: `0x${string}`;
  eventType: string;
  txHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface InvoiceSyncState {
  invoiceHash: `0x${string}`;
  source: 'backend' | 'chain' | string;
  lastEventType: string;
  lastTxHash?: `0x${string}`;
  updatedAt: number;
}

export interface ChainCursor {
  contractAddress: string;
  lastBlock: number;
  lastBlockHash?: `0x${string}`;
  lastParentHash?: `0x${string}`;
  updatedAt: number;
}

function safeJson<T>(raw: string | null | undefined, defaultValue: T): T {
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function mapChainEvent(row: any): ChainEvent {
  return {
    id: row.id,
    contractAddress: row.contract_address,
    invoiceHash: row.invoice_hash,
    eventType: row.event_type,
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    logIndex: row.log_index,
    payload: safeJson(row.payload, {}),
    createdAt: row.created_at,
  };
}

export function recordChainEvent(input: {
  contractAddress: Address;
  invoiceHash: `0x${string}`;
  eventType: string;
  txHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
  payload: Record<string, unknown>;
}): ChainEvent | undefined {
  const id = `chain_${input.txHash.toLowerCase().slice(2)}_${input.logIndex}`;
  const ts = nowSeconds();
  const result = db.prepare(`
    INSERT OR IGNORE INTO chain_events (
      id, contract_address, invoice_hash, event_type, tx_hash, block_number, log_index, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.contractAddress.toLowerCase(),
    input.invoiceHash.toLowerCase(),
    input.eventType,
    input.txHash.toLowerCase(),
    input.blockNumber,
    input.logIndex,
    JSON.stringify(input.payload),
    ts,
  );
  if (result.changes === 0) return undefined;
  db.prepare(`
    INSERT INTO invoice_sync_state (invoice_hash, source, last_event_type, last_tx_hash, updated_at)
    VALUES (?, 'chain', ?, ?, ?)
    ON CONFLICT(invoice_hash) DO UPDATE SET
      source = 'chain',
      last_event_type = excluded.last_event_type,
      last_tx_hash = excluded.last_tx_hash,
      updated_at = excluded.updated_at
  `).run(input.invoiceHash.toLowerCase(), input.eventType, input.txHash.toLowerCase(), ts);
  return getChainEvent(id);
}

export function getChainEvent(id: string): ChainEvent | undefined {
  const row = db.prepare('SELECT * FROM chain_events WHERE id = ?').get(id);
  return row ? mapChainEvent(row) : undefined;
}

export function listChainEvents(filter: { invoiceHash?: string; merchant?: Address; limit?: number; offset?: number } = {}): ChainEvent[] {
  const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
  const offset = Math.max(0, filter.offset ?? 0);
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.invoiceHash) {
    clauses.push('lower(c.invoice_hash) = lower(?)');
    params.push(filter.invoiceHash);
  }
  if (filter.merchant) {
    clauses.push('lower(i.merchant) = lower(?)');
    params.push(filter.merchant);
  }
  if (clauses.length > 0) {
    return db
      .prepare(`
        SELECT c.* FROM chain_events c
        LEFT JOIN invoices i ON lower(i.hash) = lower(c.invoice_hash)
        WHERE ${clauses.join(' AND ')}
        ORDER BY c.block_number DESC, c.log_index DESC LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset)
      .map(mapChainEvent);
  }
  return db
    .prepare('SELECT * FROM chain_events ORDER BY block_number DESC, log_index DESC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map(mapChainEvent);
}

export function countChainEvents(filter: { invoiceHash?: string; merchant?: Address } = {}): number {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.invoiceHash) {
    clauses.push('lower(c.invoice_hash) = lower(?)');
    params.push(filter.invoiceHash);
  }
  if (filter.merchant) {
    clauses.push('lower(i.merchant) = lower(?)');
    params.push(filter.merchant);
  }
  const row = clauses.length > 0
    ? db.prepare(`
      SELECT count(*) AS total FROM chain_events c
      LEFT JOIN invoices i ON lower(i.hash) = lower(c.invoice_hash)
      WHERE ${clauses.join(' AND ')}
    `).get(...params)
    : db.prepare('SELECT count(*) AS total FROM chain_events').get();
  return Number((row as { total?: number } | undefined)?.total ?? 0);
}

export function getChainCursor(contractAddress: string): number {
  return getChainCursorState(contractAddress)?.lastBlock ?? 0;
}

export function getChainCursorState(contractAddress: string): ChainCursor | undefined {
  const row = db.prepare(`
    SELECT contract_address, last_block, last_block_hash, last_parent_hash, updated_at
    FROM chain_cursor WHERE lower(contract_address) = lower(?)
  `).get(contractAddress) as
    | { contract_address: string; last_block: number; last_block_hash?: string | null; last_parent_hash?: string | null; updated_at: number }
    | undefined;
  return row ? {
    contractAddress: row.contract_address,
    lastBlock: Number(row.last_block),
    lastBlockHash: (row.last_block_hash ?? undefined) as `0x${string}` | undefined,
    lastParentHash: (row.last_parent_hash ?? undefined) as `0x${string}` | undefined,
    updatedAt: Number(row.updated_at),
  } : undefined;
}

export function setChainCursor(
  contractAddress: string,
  blockNumber: number,
  blockHash?: `0x${string}`,
  parentHash?: `0x${string}`,
): void {
  db.prepare(`
    INSERT INTO chain_cursor (contract_address, last_block, last_block_hash, last_parent_hash, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(contract_address) DO UPDATE SET
      last_block = excluded.last_block,
      last_block_hash = excluded.last_block_hash,
      last_parent_hash = excluded.last_parent_hash,
      updated_at = excluded.updated_at
    WHERE excluded.last_block > chain_cursor.last_block
  `).run(contractAddress.toLowerCase(), blockNumber, blockHash ?? null, parentHash ?? null, nowSeconds());
}

export function rollbackChainCursor(contractAddress: string, rollbackToBlock: number): number {
  const nextBlock = Math.max(0, Math.trunc(rollbackToBlock));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM chain_events WHERE lower(contract_address) = lower(?) AND block_number > ?')
      .run(contractAddress, nextBlock);
    if (nextBlock === 0) {
      db.prepare('DELETE FROM chain_cursor WHERE lower(contract_address) = lower(?)').run(contractAddress);
    } else {
      db.prepare(`
        UPDATE chain_cursor
        SET last_block = ?, last_block_hash = NULL, last_parent_hash = NULL, updated_at = ?
        WHERE lower(contract_address) = lower(?)
      `).run(nextBlock, nowSeconds(), contractAddress);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getChainCursor(contractAddress);
}

export function chainSyncStatus(contractAddress?: string): ChainCursor[] {
  const rows = contractAddress
    ? db.prepare(`
      SELECT contract_address, last_block, last_block_hash, last_parent_hash, updated_at
      FROM chain_cursor WHERE lower(contract_address) = lower(?)
    `).all(contractAddress)
    : db.prepare(`
      SELECT contract_address, last_block, last_block_hash, last_parent_hash, updated_at
      FROM chain_cursor ORDER BY updated_at DESC
    `).all();
  return (rows as Array<{
    contract_address: string;
    last_block: number;
    last_block_hash?: string | null;
    last_parent_hash?: string | null;
    updated_at: number;
  }>).map((row) => ({
    contractAddress: row.contract_address,
    lastBlock: row.last_block,
    lastBlockHash: (row.last_block_hash ?? undefined) as `0x${string}` | undefined,
    lastParentHash: (row.last_parent_hash ?? undefined) as `0x${string}` | undefined,
    updatedAt: row.updated_at,
  }));
}

export function applyIndexedInvoiceState(input: {
  invoiceHash: `0x${string}`;
  eventType: string;
  payer?: Address;
  amount?: string;
  txHash?: `0x${string}`;
  merchant?: Address;
  token?: Address;
  expiresAt?: number;
  invoiceType?: InvoiceTypeValue;
  metadataHash?: `0x${string}`;
}): Invoice | undefined {
  const inv = getInvoice(input.invoiceHash);
  if (!inv) {
    if (input.eventType !== 'invoice.created' || !input.merchant || !input.token || !input.amount) return undefined;
    return createInvoice({
      merchant: input.merchant,
      amount: input.amount,
      token: input.token,
      invoiceType: input.invoiceType,
      expiresAt: input.expiresAt,
      hash: input.invoiceHash,
      chainTxHash: input.txHash,
      metadata: { source: 'chain-indexer' },
    });
  }

  if (input.eventType === 'invoice.paid' && inv.status === InvoiceStatus.Created && input.payer && input.txHash) {
    return markPaid(input.invoiceHash, input.payer, input.txHash);
  }
  if (input.eventType === 'invoice.cancelled' && (inv.status === InvoiceStatus.Created || inv.status === InvoiceStatus.Paused)) {
    return cancelInvoice(input.invoiceHash);
  }
  if (input.eventType === 'invoice.refunded' && inv.status === InvoiceStatus.Paid) {
    return refundInvoice(input.invoiceHash, 'indexed on-chain refund');
  }
  if (input.eventType === 'invoice.paused' && inv.status === InvoiceStatus.Created) {
    return pauseInvoice(input.invoiceHash);
  }
  if (input.eventType === 'invoice.resumed' && inv.status === InvoiceStatus.Paused) {
    return resumeInvoice(input.invoiceHash);
  }
  return inv;
}
