export default {
  id: '0006_webhook_retry_payloads',
  sql: `
    -- Columns are added by the idempotent compatibility path in store.ts when needed.
    -- New databases already receive them from 0001_core_sqlite.
    SELECT 1;
  `,
};
