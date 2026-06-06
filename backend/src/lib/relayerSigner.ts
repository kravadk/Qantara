import { JsonRpcProvider, Wallet, Contract, formatEther, type TransactionReceipt } from 'ethers';
import { optionalEnv } from './env.js';

const QIE_RPC = optionalEnv('QIE_RPC_URL') ?? 'https://rpc1mainnet.qie.digital';
const CHAIN_ID = 1990;

const RELAY_ABI = [
  'function execute((address from,address to,uint256 value,uint256 gas,uint256 nonce,uint64 deadline,bytes data) req, bytes signature) external payable returns (bool, bytes)',
  'function verify((address from,address to,uint256 value,uint256 gas,uint256 nonce,uint64 deadline,bytes data) req, bytes signature) external view returns (bool)',
  'function allowedSelectors(address target, bytes4 selector) view returns (bool)',
  'function nonces(address) view returns (uint256)',
];

let _provider: JsonRpcProvider | null = null;
let _wallet: Wallet | null = null;

function provider() {
  if (!_provider) _provider = new JsonRpcProvider(QIE_RPC, { chainId: CHAIN_ID, name: 'qie' });
  return _provider;
}

export function getRelayerWallet(): Wallet {
  if (_wallet) return _wallet;
  const pk = optionalEnv('RELAYER_PK');
  if (!pk) throw new Error('RELAYER_PK not configured');
  _wallet = new Wallet(pk, provider());
  return _wallet;
}

export function getRelayAddress(): string | null {
  return optionalEnv('QANTARA_GAS_RELAY_ADDRESS') ?? optionalEnv('VITE_QANTARA_GAS_RELAY_ADDRESS') ?? null;
}

export async function getRelayerBalance(): Promise<bigint> {
  return await provider().getBalance(getRelayerWallet().address);
}

export async function getRelayerStatus() {
  try {
    const wallet = getRelayerWallet();
    const balance = await getRelayerBalance();
    return {
      ok: true,
      address: wallet.address,
      balanceWei: balance.toString(),
      balanceQie: formatEther(balance),
      contract: getRelayAddress(),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'no_relayer' };
  }
}

export interface ForwardRequestInput {
  from: string;
  to: string;
  value: string;   // wei as decimal string
  gas: string;
  nonce: string;
  deadline: number;
  data: string;
}

/**
 * Submit a signed ForwardRequest to QantaraGasRelay.execute(). Returns the tx hash
 * after it's been included. Throws on revert.
 */
export async function sponsorForwardRequest(
  req: ForwardRequestInput,
  signature: string,
): Promise<{ txHash: string; receipt: TransactionReceipt }> {
  const relayAddr = getRelayAddress();
  if (!relayAddr) throw new Error('QANTARA_GAS_RELAY_ADDRESS not configured');
  const wallet = getRelayerWallet();
  const contract = new Contract(relayAddr, RELAY_ABI, wallet);

  // Pre-flight verify (fails fast on bad sig / wrong nonce).
  const ok = await contract.verify(
    [req.from, req.to, BigInt(req.value), BigInt(req.gas), BigInt(req.nonce), req.deadline, req.data],
    signature,
  );
  if (!ok) throw new Error('verify_failed_offchain');

  const tx = await contract.execute(
    [req.from, req.to, BigInt(req.value), BigInt(req.gas), BigInt(req.nonce), req.deadline, req.data],
    signature,
    { value: BigInt(req.value) },
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error('relay_tx_reverted');
  return { txHash: receipt.hash, receipt };
}

export function decodeSelector(data: string): string {
  return data.startsWith('0x') ? data.slice(0, 10) : '0x' + data.slice(0, 8);
}
