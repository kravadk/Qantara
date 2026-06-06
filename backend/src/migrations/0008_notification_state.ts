export default {
  id: '0008_notification_state',
  sql: `
    CREATE TABLE IF NOT EXISTS notification_state (
      notification_id TEXT NOT NULL,
      merchant TEXT NOT NULL,
      read_at INTEGER,
      dismissed_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (notification_id, merchant)
    );
    CREATE INDEX IF NOT EXISTS idx_notification_state_merchant ON notification_state(merchant, updated_at);
  `,
};
