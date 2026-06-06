export default {
  id: '0004_payment_intents_and_auth',
  sql: `
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

    CREATE TABLE IF NOT EXISTS siwe_nonces (
      nonce TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_siwe_nonces_expires_at ON siwe_nonces(expires_at);
  `,
};
