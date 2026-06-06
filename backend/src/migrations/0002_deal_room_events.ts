export default {
  id: '0002_deal_room_events',
  sql: `
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
  `,
};
