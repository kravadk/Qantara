export default {
  id: '0001_core_sqlite',
  sql: `
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
  `,
};
