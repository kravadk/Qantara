export default {
  id: '0003_receipts_webhooks_chain_api_keys',
  sql: `
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
      FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_merchant_issued ON receipts(merchant, issued_at);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      invoice_hash TEXT NOT NULL,
      event_type TEXT NOT NULL,
      target_url TEXT NOT NULL,
      status INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      last_error TEXT,
      next_retry_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (invoice_hash) REFERENCES invoices(hash) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_invoice ON webhook_deliveries(invoice_hash, updated_at);

    CREATE TABLE IF NOT EXISTS chain_cursor (
      contract_address TEXT PRIMARY KEY,
      last_block INTEGER NOT NULL,
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
  `,
};
