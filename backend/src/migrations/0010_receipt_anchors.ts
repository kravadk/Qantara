export default {
  id: '0010_receipt_anchors',
  sql: `
    ALTER TABLE receipts ADD COLUMN anchored_at INTEGER;
    ALTER TABLE receipts ADD COLUMN anchor_tx_hash TEXT;
    ALTER TABLE receipts ADD COLUMN anchor_status TEXT;
  `,
};
