export const qantaraSplitsAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'computeSplitId',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'sharesBps',  type: 'uint32[]'  },
      { name: 'salt',       type: 'bytes32'   },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'createSplit',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'sharesBps',  type: 'uint32[]'  },
      { name: 'controller', type: 'address'   },
      { name: 'salt',       type: 'bytes32'   },
    ],
    outputs: [{ name: 'splitId', type: 'bytes32' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getSplit',
    inputs: [{ name: 'splitId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'recipients', type: 'address[]' },
          { name: 'sharesBps',  type: 'uint32[]'  },
          { name: 'controller', type: 'address'   },
          { name: 'createdAt',  type: 'uint64'    },
        ],
      },
    ],
  },
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'distributeNative',
    inputs: [{ name: 'splitId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'distributeERC20',
    inputs: [
      { name: 'splitId', type: 'bytes32' },
      { name: 'token',   type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'withdrawPull',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'pendingPull',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'SplitCreated',
    inputs: [
      { indexed: true,  name: 'splitId',    type: 'bytes32' },
      { indexed: true,  name: 'controller', type: 'address' },
      { indexed: false, name: 'recipients', type: 'address[]' },
      { indexed: false, name: 'sharesBps',  type: 'uint32[]'  },
    ],
  },
] as const;

export const QANTARA_SPLITS_ADDRESS =
  (import.meta.env.VITE_QANTARA_SPLITS_ADDRESS as `0x${string}` | undefined) ??
  '0xBbaeF9CF47C31436505E46cF2a39636a76C7C413';
