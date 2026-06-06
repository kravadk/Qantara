import { createPublicClient, decodeEventLog, formatEther, formatUnits, getAddress, http, parseAbi, parseEther, parseUnits, type Address, type Hex } from 'viem';
import { optionalEnv } from './env.js';
import * as store from './store.js';
import { qieRpcTransport } from './qieEcosystem.js';

const QIE_RPC_URL = optionalEnv('QIE_RPC_URL') ?? 'https://rpc1mainnet.qie.digital';
const QUSDC_ADDRESS = optionalEnv('QUSDC_ADDRESS');

const client = createPublicClient({
  transport: qieRpcTransport(),
});

const tokenAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

const invoiceContractAbi = parseAbi([
  'event InvoiceCreated(bytes32 indexed invoiceHash, address indexed merchant, address indexed token, uint256 amount, uint8 invoiceType, uint64 expiresAt, bytes32 metadataHash)',
  'event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer, uint256 amount)',
  'event InvoiceCancelled(bytes32 indexed invoiceHash)',
  'event InvoiceRefunded(bytes32 indexed invoiceHash, uint256 amount)',
  'event InvoicePaused(bytes32 indexed invoiceHash)',
  'event InvoiceResumed(bytes32 indexed invoiceHash)',
]);

async function getBlockIdentity(blockNumber: bigint): Promise<{ hash: Hex; parentHash: Hex }> {
  const block = await client.getBlock({ blockNumber });
  if (!block.hash || !block.parentHash) {
    throw new Error(`Block ${blockNumber.toString()} is missing hash metadata`);
  }
  return {
    hash: block.hash as Hex,
    parentHash: block.parentHash as Hex,
  };
}

export async function rpcStatus() {
  try {
    const [blockNumber, chainId] = await Promise.all([
      client.getBlockNumber(),
      client.getChainId(),
    ]);
    return {
      ok: true,
      url: process.env.QIE_RPC_URL ? 'custom' : 'default-qie-mainnet',
      chainId,
      blockNumber: Number(blockNumber),
    };
  } catch (err: any) {
    return {
      ok: false,
      url: process.env.QIE_RPC_URL ? 'custom' : 'default-qie-mainnet',
      error: err?.message ?? 'rpc_unavailable',
    };
  }
}

export async function verifyNativePayment(input: {
  txHash: Hex;
  invoiceHash?: Hex;
  merchant: Address;
  payer: Address;
  amount: string;
}) {
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: input.txHash }),
    client.getTransactionReceipt({ hash: input.txHash }),
  ]);

  if (receipt.status !== 'success') {
    throw new Error('Transaction was not successful');
  }
  if (getAddress(tx.from) !== getAddress(input.payer)) {
    throw new Error('Transaction payer does not match connected wallet');
  }
  const requiredAmount = parseEther(input.amount);
  const directMerchantPayment = tx.to
    && getAddress(tx.to) === getAddress(input.merchant)
    && tx.value >= requiredAmount;
  if (directMerchantPayment) return;

  const contractPayment = hasMatchingQantaraPaymentEvent({
    receipt,
    txTo: tx.to ?? undefined,
    invoiceHash: input.invoiceHash,
    payer: input.payer,
    requiredAmount,
  });
  if (contractPayment) return;

  if (tx.value < requiredAmount) {
    throw new Error(`Transaction value ${formatEther(tx.value)} QIE is below invoice amount`);
  }
  throw new Error('No matching direct QIE transfer or Qantara InvoicePaid event found');
}

export async function verifyTokenPayment(input: {
  txHash: Hex;
  invoiceHash?: Hex;
  merchant: Address;
  payer: Address;
  amount: string;
}) {
  if (!QUSDC_ADDRESS) {
    throw new Error('QUSDC_ADDRESS is required to verify token payments');
  }

  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: input.txHash }),
    client.getTransactionReceipt({ hash: input.txHash }),
  ]);
  if (receipt.status !== 'success') {
    throw new Error('Transaction was not successful');
  }

  const tokenAddress = getAddress(QUSDC_ADDRESS);
  const decimals = await client.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: 'decimals',
  });
  const requiredAmount = parseUnits(input.amount, decimals);
  if (getAddress(tx.from) !== getAddress(input.payer)) {
    throw new Error('Transaction payer does not match connected wallet');
  }

  const contractPayment = hasMatchingQantaraPaymentEvent({
    receipt,
    txTo: tx.to ?? undefined,
    invoiceHash: input.invoiceHash,
    payer: input.payer,
    requiredAmount,
  });
  if (contractPayment) return;

  const hasMatchingTransfer = receipt.logs.some((log) => {
    if (getAddress(log.address) !== tokenAddress) return false;
    try {
      const decoded = decodeEventLog({
        abi: tokenAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'Transfer') return false;
      return (
        getAddress(decoded.args.from) === getAddress(input.payer) &&
        getAddress(decoded.args.to) === getAddress(input.merchant) &&
        decoded.args.value >= requiredAmount
      );
    } catch {
      return false;
    }
  });

  if (!hasMatchingTransfer) {
    throw new Error('No matching direct QUSDC transfer or Qantara InvoicePaid event found in transaction receipt');
  }
}

function configuredQantaraAddress(): Address | undefined {
  const value = optionalEnv('QANTARA_ADDRESS');
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? getAddress(value as Address) : undefined;
}

function hasMatchingQantaraPaymentEvent(input: {
  receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  txTo?: Address;
  invoiceHash?: Hex;
  payer: Address;
  requiredAmount: bigint;
}): boolean {
  const contractAddress = configuredQantaraAddress();
  if (!contractAddress || !input.invoiceHash || !input.txTo || getAddress(input.txTo) !== contractAddress) {
    return false;
  }
  const expectedHash = input.invoiceHash.toLowerCase();
  return input.receipt.logs.some((log) => {
    if (getAddress(log.address) !== contractAddress) return false;
    try {
      const decoded = decodeEventLog({
        abi: invoiceContractAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'InvoicePaid') return false;
      return (
        decoded.args.invoiceHash.toLowerCase() === expectedHash
        && getAddress(decoded.args.payer) === getAddress(input.payer)
        && decoded.args.amount >= input.requiredAmount
      );
    } catch {
      return false;
    }
  });
}

export async function verifyNativeRefund(input: {
  txHash: Hex;
  merchant: Address;
  payer: Address;
  amount: string;
}) {
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: input.txHash }),
    client.getTransactionReceipt({ hash: input.txHash }),
  ]);

  if (receipt.status !== 'success') {
    throw new Error('Refund transaction was not successful');
  }
  if (getAddress(tx.from) !== getAddress(input.merchant)) {
    throw new Error('Refund sender does not match invoice merchant');
  }
  if (!tx.to || getAddress(tx.to) !== getAddress(input.payer)) {
    throw new Error('Refund recipient does not match invoice payer');
  }
  if (tx.value < parseEther(input.amount)) {
    throw new Error(`Refund value ${formatEther(tx.value)} QIE is below invoice amount`);
  }
}

export async function verifyTokenRefund(input: {
  txHash: Hex;
  merchant: Address;
  payer: Address;
  amount: string;
}) {
  if (!QUSDC_ADDRESS) {
    throw new Error('QUSDC_ADDRESS is required to verify token refunds');
  }

  const receipt = await client.getTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== 'success') {
    throw new Error('Refund transaction was not successful');
  }

  const tokenAddress = getAddress(QUSDC_ADDRESS);
  const decimals = await client.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: 'decimals',
  });
  const requiredAmount = parseUnits(input.amount, decimals);

  const hasMatchingTransfer = receipt.logs.some((log) => {
    if (getAddress(log.address) !== tokenAddress) return false;
    try {
      const decoded = decodeEventLog({
        abi: tokenAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'Transfer') return false;
      return (
        getAddress(decoded.args.from) === getAddress(input.merchant) &&
        getAddress(decoded.args.to) === getAddress(input.payer) &&
        decoded.args.value >= requiredAmount
      );
    } catch {
      return false;
    }
  });

  if (!hasMatchingTransfer) {
    throw new Error('No matching QUSDC refund transfer found in transaction receipt');
  }
}

export async function verifyQantaraLifecycleEvent(input: {
  txHash: Hex;
  invoiceHash: Hex;
  merchant: Address;
  eventName: 'InvoiceCancelled' | 'InvoicePaused' | 'InvoiceResumed';
  contractAddress?: Address;
}): Promise<{ blockNumber: number; logIndex: number; txHash: Hex; eventType: string; contractAddress: Address }> {
  const configuredAddress = input.contractAddress ?? optionalEnv('QANTARA_ADDRESS');
  if (!configuredAddress || !/^0x[a-fA-F0-9]{40}$/.test(configuredAddress)) {
    throw new Error('QANTARA_ADDRESS is required to verify contract lifecycle actions');
  }

  const contractAddress = getAddress(configuredAddress as Address);
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: input.txHash }),
    client.getTransactionReceipt({ hash: input.txHash }),
  ]);
  if (receipt.status !== 'success') {
    throw new Error('Lifecycle transaction was not successful');
  }
  if (getAddress(tx.from) !== getAddress(input.merchant)) {
    throw new Error('Lifecycle transaction sender does not match invoice merchant');
  }

  const expectedHash = input.invoiceHash.toLowerCase();
  const match = receipt.logs.find((log) => {
    if (getAddress(log.address) !== contractAddress) return false;
    try {
      const decoded = decodeEventLog({
        abi: invoiceContractAbi,
        data: log.data,
        topics: log.topics,
      });
      return decoded.eventName === input.eventName && (decoded.args.invoiceHash as string).toLowerCase() === expectedHash;
    } catch {
      return false;
    }
  });
  if (!match) {
    throw new Error(`No matching ${input.eventName} event found for invoice`);
  }

  const eventMap = {
    InvoiceCancelled: 'invoice.cancelled',
    InvoicePaused: 'invoice.paused',
    InvoiceResumed: 'invoice.resumed',
  } as const;
  return {
    blockNumber: Number(match.blockNumber),
    logIndex: Number(match.logIndex),
    txHash: input.txHash,
    eventType: eventMap[input.eventName],
    contractAddress,
  };
}

export async function verifyQantaraRefundEvent(input: {
  txHash: Hex;
  invoiceHash: Hex;
  merchant: Address;
  contractAddress?: Address;
}): Promise<{ blockNumber: number; logIndex: number; txHash: Hex; eventType: 'invoice.refunded'; contractAddress: Address; amount: string }> {
  const configuredAddress = input.contractAddress ?? optionalEnv('QANTARA_ADDRESS');
  if (!configuredAddress || !/^0x[a-fA-F0-9]{40}$/.test(configuredAddress)) {
    throw new Error('QANTARA_ADDRESS is required to verify contract refunds');
  }

  const contractAddress = getAddress(configuredAddress as Address);
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: input.txHash }),
    client.getTransactionReceipt({ hash: input.txHash }),
  ]);
  if (receipt.status !== 'success') {
    throw new Error('Refund transaction was not successful');
  }
  if (getAddress(tx.from) !== getAddress(input.merchant)) {
    throw new Error('Refund transaction sender does not match invoice merchant');
  }

  const expectedHash = input.invoiceHash.toLowerCase();
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== contractAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: invoiceContractAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'InvoiceRefunded') continue;
      if ((decoded.args.invoiceHash as string).toLowerCase() !== expectedHash) continue;
      return {
        blockNumber: Number(log.blockNumber),
        logIndex: Number(log.logIndex),
        txHash: input.txHash,
        eventType: 'invoice.refunded',
        contractAddress,
        amount: decoded.args.amount.toString(),
      };
    } catch {
      continue;
    }
  }

  throw new Error('No matching InvoiceRefunded event found for invoice');
}

export async function syncQantaraContractEvents(input: {
  contractAddress: Address;
  fromBlock?: bigint;
  toBlock?: bigint;
  maxBlockRange?: bigint;
}) {
  const contractAddress = getAddress(input.contractAddress);
  // Confirmation depth keeps the indexer a fixed number of blocks behind the
  // chain head so shallow re-orgs never affect already-indexed payment state.
  // Defaults to 0 (index to head) to preserve legacy behavior; set
  // CHAIN_CONFIRMATIONS in production for re-org safety. Re-indexing is safe
  // regardless: chain_events is written with INSERT OR IGNORE on a
  // UNIQUE(contract, tx_hash, log_index) constraint.
  const confirmations = BigInt(Math.max(0, Math.trunc(Number(process.env.CHAIN_CONFIRMATIONS ?? '0')) || 0));
  const reorgRollbackBlocks = Math.max(1, Math.trunc(Number(process.env.CHAIN_REORG_ROLLBACK_BLOCKS ?? '12')) || 12);
  const head = await client.getBlockNumber();
  const currentBlock = head > confirmations ? head - confirmations : 0n;
  let cursorState = store.getChainCursorState(contractAddress);
  let storedCursor = cursorState?.lastBlock ?? 0;
  let reorgRollbackBlock: number | undefined;

  if (!input.fromBlock && cursorState?.lastBlock && cursorState.lastBlockHash) {
    const canonicalCursorBlock = await getBlockIdentity(BigInt(cursorState.lastBlock));
    if (canonicalCursorBlock.hash.toLowerCase() !== cursorState.lastBlockHash.toLowerCase()) {
      reorgRollbackBlock = Math.max(0, cursorState.lastBlock - reorgRollbackBlocks);
      storedCursor = store.rollbackChainCursor(contractAddress, reorgRollbackBlock);
      cursorState = store.getChainCursorState(contractAddress);
    }
  }

  const fromBlock = input.fromBlock ?? (storedCursor > 0 ? BigInt(storedCursor + 1) : currentBlock);
  const maxBlockRange = input.maxBlockRange ?? 2_000n;
  const toBlock = input.toBlock ?? (fromBlock + maxBlockRange > currentBlock ? currentBlock : fromBlock + maxBlockRange);
  if (toBlock < fromBlock) {
    return {
      ok: true,
      contractAddress,
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      indexed: 0,
      cursor: storedCursor,
      cursorBlockHash: cursorState?.lastBlockHash,
      reorgRollbackBlock,
    };
  }

  const logs = await client.getLogs({
    address: contractAddress,
    events: invoiceContractAbi,
    fromBlock,
    toBlock,
  });

  let indexed = 0;
  for (const log of logs) {
    const decoded = decodeEventLog({
      abi: invoiceContractAbi,
      data: log.data,
      topics: log.topics as any,
    });
    const invoiceHash = decoded.args.invoiceHash as `0x${string}`;
    const txHash = log.transactionHash as `0x${string}`;
    const blockNumber = Number(log.blockNumber);
    const logIndex = Number(log.logIndex);

    if (decoded.eventName === 'InvoiceCreated') {
      const amount = formatUnits(decoded.args.amount, decoded.args.token === '0x0000000000000000000000000000000000000000' ? 18 : 6);
      store.recordChainEvent({
        contractAddress,
        invoiceHash,
        eventType: 'invoice.created',
        txHash,
        blockNumber,
        logIndex,
        payload: {
          merchant: decoded.args.merchant,
          token: decoded.args.token,
          amount,
          invoiceType: Number(decoded.args.invoiceType),
          expiresAt: Number(decoded.args.expiresAt),
          metadataHash: decoded.args.metadataHash,
        },
      });
      store.applyIndexedInvoiceState({
        invoiceHash,
        eventType: 'invoice.created',
        txHash,
        merchant: decoded.args.merchant,
        token: decoded.args.token,
        amount,
        invoiceType: Number(decoded.args.invoiceType) as any,
        expiresAt: Number(decoded.args.expiresAt),
        metadataHash: decoded.args.metadataHash,
      });
      indexed += 1;
    } else if (decoded.eventName === 'InvoicePaid') {
      store.recordChainEvent({
        contractAddress,
        invoiceHash,
        eventType: 'invoice.paid',
        txHash,
        blockNumber,
        logIndex,
        payload: { payer: decoded.args.payer, amount: decoded.args.amount.toString() },
      });
      store.applyIndexedInvoiceState({
        invoiceHash,
        eventType: 'invoice.paid',
        txHash,
        payer: decoded.args.payer,
      });
      indexed += 1;
    } else {
      const eventMap: Record<string, string> = {
        InvoiceCancelled: 'invoice.cancelled',
        InvoiceRefunded: 'invoice.refunded',
        InvoicePaused: 'invoice.paused',
        InvoiceResumed: 'invoice.resumed',
      };
      const eventType = eventMap[decoded.eventName];
      store.recordChainEvent({
        contractAddress,
        invoiceHash,
        eventType,
        txHash,
        blockNumber,
        logIndex,
        payload: decoded.eventName === 'InvoiceRefunded' ? { amount: decoded.args.amount.toString() } : {},
      });
      store.applyIndexedInvoiceState({ invoiceHash, eventType, txHash });
      indexed += 1;
    }
  }

  const cursorBlock = await getBlockIdentity(toBlock);
  store.setChainCursor(contractAddress, Number(toBlock), cursorBlock.hash, cursorBlock.parentHash);
  const syncedCursor = store.getChainCursorState(contractAddress);
  return {
    ok: true,
    contractAddress,
    fromBlock: Number(fromBlock),
    toBlock: Number(toBlock),
    indexed,
    cursor: syncedCursor?.lastBlock ?? store.getChainCursor(contractAddress),
    cursorBlockHash: syncedCursor?.lastBlockHash,
    cursorParentHash: syncedCursor?.lastParentHash,
    reorgRollbackBlock,
  };
}
