/**
 * Shared SQLite connection, schema bootstrap, migrations, and the in-process
 * event bus. Repository modules import `db` / `eventBus` / `nowSeconds` from here
 * so the store layer is not a single monolith. This module is the leaf — it must
 * not import from store.ts or repositories.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrationIds, runSqlMigrations } from './migrations.js';

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

const dbPath = process.env.QANTARA_DB_PATH ?? resolve(process.cwd(), 'data', 'qantara.sqlite');
if (dbPath !== ':memory:') {
  mkdirSync(dirname(dbPath), { recursive: true });
}

export const db = new DatabaseSync(dbPath);
runSqlMigrations(db);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS invoices (
    hash TEXT PRIMARY KEY,
    merchant TEXT NOT NULL,
    payer TEXT,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    invoice_type INTEGER NOT NULL,
    status INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata_hash TEXT NOT NULL,
    title TEXT,
    memo TEXT,
    paid_at INTEGER,
    paid_tx_hash TEXT,
    webhook_url TEXT,
    success_url TEXT,
    cancel_url TEXT,
    webhook_events TEXT NOT NULL DEFAULT '[]',
    guest_token TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    invoice_hash TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    sender_address TEXT,
    sender_label TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_invoice_hash_created_at ON messages(invoice_hash, created_at);

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    invoice_hash TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_events_invoice_hash_created_at ON events(invoice_hash, created_at);

  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    invoice_hash TEXT NOT NULL UNIQUE,
    tx_hash TEXT NOT NULL,
    payer TEXT NOT NULL,
    merchant TEXT NOT NULL,
    amount TEXT NOT NULL,
    token TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    receipt_hash TEXT NOT NULL UNIQUE,
    anchored_at INTEGER,
    anchor_tx_hash TEXT,
    anchor_status TEXT,
    FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_receipts_merchant_issued ON receipts(merchant, issued_at);

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    invoice_hash TEXT NOT NULL,
    event_id TEXT,
    event_type TEXT NOT NULL,
    target_url TEXT NOT NULL,
    status INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    last_error TEXT,
    next_retry_at INTEGER,
    event_payload TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_invoice ON webhook_deliveries(invoice_hash, updated_at);

  CREATE TABLE IF NOT EXISTS chain_cursor (
    contract_address TEXT PRIMARY KEY,
    last_block INTEGER NOT NULL,
    last_block_hash TEXT,
    last_parent_hash TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chain_events (
    id TEXT PRIMARY KEY,
    contract_address TEXT NOT NULL,
    invoice_hash TEXT NOT NULL,
    event_type TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    log_index INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(contract_address, tx_hash, log_index)
  );
  CREATE INDEX IF NOT EXISTS idx_chain_events_invoice ON chain_events(invoice_hash, block_number, log_index);

  CREATE TABLE IF NOT EXISTS invoice_sync_state (
    invoice_hash TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    last_event_type TEXT NOT NULL,
    last_tx_hash TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS operational_alert_deliveries (
    alert_id TEXT PRIMARY KEY,
    severity TEXT NOT NULL,
    status INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    last_value REAL,
    last_threshold REAL,
    last_error TEXT,
    last_sent_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    merchant TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_merchant ON api_keys(merchant, created_at);

  CREATE TABLE IF NOT EXISTS merchant_webhook_secrets (
    merchant TEXT PRIMARY KEY,
    secret TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    rotated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merchant_telegram_chats (
    merchant TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    creator_id TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS merchant_profiles (
    merchant TEXT PRIMARY KEY,
    display_name TEXT,
    website TEXT,
    public_listed INTEGER NOT NULL DEFAULT 0,
    wallet_verified INTEGER NOT NULL DEFAULT 0,
    domain TEXT,
    domain_token TEXT,
    domain_verified_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_merchant_profiles_listed ON merchant_profiles(public_listed, updated_at);

  CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    invoice_hash TEXT NOT NULL,
    merchant TEXT NOT NULL,
    payer TEXT,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    deadline INTEGER NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    signature TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    used_at INTEGER,
    FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_payment_intents_invoice ON payment_intents(invoice_hash, created_at);

  CREATE TABLE IF NOT EXISTS notification_state (
    notification_id TEXT NOT NULL,
    merchant TEXT NOT NULL,
    read_at INTEGER,
    dismissed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (notification_id, merchant)
  );
  CREATE INDEX IF NOT EXISTS idx_notification_state_merchant ON notification_state(merchant, updated_at);

  CREATE TABLE IF NOT EXISTS telegram_links (
    invoice_hash TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    creator_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS siwe_nonces (
    nonce TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_siwe_nonces_expires_at ON siwe_nonces(expires_at);

  CREATE TABLE IF NOT EXISTS relay_log (
    id TEXT PRIMARY KEY,
    from_addr TEXT NOT NULL,
    target TEXT NOT NULL,
    selector TEXT NOT NULL,
    tx_hash TEXT,
    value TEXT NOT NULL,
    gas_used TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_relay_log_from_created ON relay_log(from_addr, created_at);

  CREATE TABLE IF NOT EXISTS onramp_orders (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    wallet_addr TEXT NOT NULL,
    amount_fiat TEXT,
    currency_fiat TEXT,
    amount_crypto TEXT,
    currency_crypto TEXT,
    status TEXT NOT NULL,
    invoice_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_onramp_orders_wallet ON onramp_orders(wallet_addr, created_at);

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`);

const invoiceColumns = db.prepare('PRAGMA table_info(invoices)').all() as Array<{ name: string }>;
if (!invoiceColumns.some((column) => column.name === 'metadata')) {
  db.exec("ALTER TABLE invoices ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';");
}

const webhookDeliveryColumns = db.prepare('PRAGMA table_info(webhook_deliveries)').all() as Array<{ name: string }>;
if (!webhookDeliveryColumns.some((column) => column.name === 'event_id')) {
  db.exec('ALTER TABLE webhook_deliveries ADD COLUMN event_id TEXT;');
}
if (!webhookDeliveryColumns.some((column) => column.name === 'event_payload')) {
  db.exec('ALTER TABLE webhook_deliveries ADD COLUMN event_payload TEXT;');
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface SchemaMigration {
  id: string;
  appliedAt: number;
}

export function closeDatabase(): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // best-effort WAL checkpoint before close
  }
  try {
    db.close();
  } catch {
    // already closed
  }
}

export function migrationStatus(): { current: string; applied: SchemaMigration[] } {
  const rows = db.prepare('SELECT id, applied_at FROM schema_migrations ORDER BY id ASC').all() as Array<{
    id: string;
    applied_at: number;
  }>;
  return {
    current: migrationIds[migrationIds.length - 1],
    applied: rows.map((row) => ({ id: row.id, appliedAt: row.applied_at })),
  };
}
