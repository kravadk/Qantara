export const qantaraStreamsAbi = [
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'createStream',
    inputs: [
      { name: 'recipient',    type: 'address' },
      { name: 'token',        type: 'address' },
      { name: 'amountPerSec', type: 'uint256' },
      { name: 'startsAt',     type: 'uint64'  },
      { name: 'endsAt',       type: 'uint64'  },
    ],
    outputs: [{ name: 'streamId', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'streams',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'payer',        type: 'address' },
      { name: 'recipient',    type: 'address' },
      { name: 'token',        type: 'address' },
      { name: 'amountPerSec', type: 'uint256' },
      { name: 'startsAt',     type: 'uint64'  },
      { name: 'endsAt',       type: 'uint64'  },
      { name: 'deposited',    type: 'uint256' },
      { name: 'withdrawn',    type: 'uint256' },
      { name: 'cancelled',    type: 'bool'    },
    ],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'withdrawable',
    inputs: [{ name: 'streamId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'nextStreamId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'withdraw',
    inputs: [{ name: 'streamId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'cancel',
    inputs: [{ name: 'streamId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'StreamCreated',
    inputs: [
      { indexed: true,  name: 'streamId',     type: 'uint256' },
      { indexed: true,  name: 'payer',        type: 'address' },
      { indexed: true,  name: 'recipient',    type: 'address' },
      { indexed: false, name: 'token',        type: 'address' },
      { indexed: false, name: 'amountPerSec', type: 'uint256' },
      { indexed: false, name: 'startsAt',     type: 'uint64'  },
      { indexed: false, name: 'endsAt',       type: 'uint64'  },
      { indexed: false, name: 'deposited',    type: 'uint256' },
    ],
  },
] as const;

export const QANTARA_STREAMS_ADDRESS =
  (import.meta.env.VITE_QANTARA_SUBSCRIPTION_V2_ADDRESS as `0x${string}` | undefined) ??
  '0x30ACe939BD62b6a9E9aF3f5AB4287b5FB5F39c06';
