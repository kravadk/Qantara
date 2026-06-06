export default {
  id: '0005_refunds_and_schema_status',
  sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `,
};
