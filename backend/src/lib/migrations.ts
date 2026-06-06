import type { DatabaseSync } from 'node:sqlite';
import coreSqlite from '../migrations/0001_core_sqlite.js';
import dealRoomEvents from '../migrations/0002_deal_room_events.js';
import receiptsWebhooksChainApiKeys from '../migrations/0003_receipts_webhooks_chain_api_keys.js';
import paymentIntentsAndAuth from '../migrations/0004_payment_intents_and_auth.js';
import refundsAndSchemaStatus from '../migrations/0005_refunds_and_schema_status.js';
import webhookRetryPayloads from '../migrations/0006_webhook_retry_payloads.js';
import operationalAlertDeliveries from '../migrations/0007_operational_alert_deliveries.js';
import notificationState from '../migrations/0008_notification_state.js';
import chainCursorBlockHash from '../migrations/0009_chain_cursor_block_hash.js';
import receiptAnchors from '../migrations/0010_receipt_anchors.js';

export interface SqlMigration {
  id: string;
  sql: string;
}

export const migrations: SqlMigration[] = [
  coreSqlite,
  dealRoomEvents,
  receiptsWebhooksChainApiKeys,
  paymentIntentsAndAuth,
  refundsAndSchemaStatus,
  webhookRetryPayloads,
  operationalAlertDeliveries,
  notificationState,
  chainCursorBlockHash,
  receiptAnchors,
];

export const migrationIds = migrations.map((migration) => migration.id);

export function runSqlMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));
  const insert = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      insert.run(migration.id, Math.floor(Date.now() / 1000));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
