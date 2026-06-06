export default {
  id: '0007_operational_alert_deliveries',
  sql: `
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
  `,
};
