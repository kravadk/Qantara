export default {
  id: '0009_chain_cursor_block_hash',
  sql: `
    ALTER TABLE chain_cursor ADD COLUMN last_block_hash TEXT;
    ALTER TABLE chain_cursor ADD COLUMN last_parent_hash TEXT;
  `,
};
