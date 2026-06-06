/**
 * Minimal ABI for QantaraChat (V4).
 */
export const qantaraChatAbi = [
  {
    type: 'event',
    name: 'Message',
    inputs: [
      { indexed: true,  name: 'conversationId', type: 'bytes32' },
      { indexed: true,  name: 'id',             type: 'uint64'  },
      { indexed: true,  name: 'from',           type: 'address' },
      { indexed: false, name: 'to',             type: 'address' },
      { indexed: false, name: 'ciphertext',     type: 'bytes'   },
      { indexed: false, name: 'metadataHash',   type: 'bytes32' },
      { indexed: false, name: 'timestamp',      type: 'uint64'  },
    ],
  },
  {
    type: 'function',
    stateMutability: 'pure',
    name: 'conversationIdFor',
    inputs: [
      { name: 'a', type: 'address' },
      { name: 'b', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'messageCount',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'sendMessage',
    inputs: [
      { name: 'to',           type: 'address' },
      { name: 'ciphertext',   type: 'bytes' },
      { name: 'metadataHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'id', type: 'uint64' }],
  },
] as const;

export const QANTARA_CHAT_ADDRESS =
  (import.meta.env.VITE_QANTARA_CHAT_ADDRESS as `0x${string}` | undefined) ??
  '0x76E618ecca8D97038Ec11641E16b9e16a378576A';
