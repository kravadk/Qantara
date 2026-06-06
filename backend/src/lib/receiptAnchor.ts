import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { optionalEnv } from './env.js';
import type { Receipt } from './store.js';

/**
 * Optional on-chain anchoring of backend-issued receipts into QantaraReceiptRegistry.
 *
 * Anchoring NEVER determines paid/refunded state. Receipts are issued only from
 * verified payment state; anchoring just mirrors an already-issued receipt hash
 * on-chain for auditability. The whole feature is dormant unless both a registry
 * address and an anchoring signer key are configured.
 */

const QIE_RPC = optionalEnv('QIE_RPC_URL') ?? 'https://rpc1mainnet.qie.digital';
const CHAIN_ID = 1990;
const MAX_URI_BYTES = 256;

const REGISTRY_ABI = [
  'function anchorReceipt(bytes32 invoiceHash, bytes32 receiptHash, bytes32 paymentTxHash, address merchant, address payer, string uri) external returns (tuple(bytes32 invoiceHash, bytes32 receiptHash, bytes32 paymentTxHash, address merchant, address payer, address issuer, uint64 anchoredAt, string uri))',
  'function isAnchored(bytes32 receiptHash) view returns (bool)',
];

let _provider: JsonRpcProvider | null = null;
let _wallet: Wallet | null = null;

function provider(): JsonRpcProvider {
  if (!_provider) _provider = new JsonRpcProvider(QIE_RPC, { chainId: CHAIN_ID, name: 'qie' });
  return _provider;
}

export function getRegistryAddress(): string | null {
  return optionalEnv('QANTARA_RECEIPT_REGISTRY_ADDRESS') ?? null;
}

function anchorPrivateKey(): string | null {
  // Dedicated key preferred; falls back to the gas-relay hot wallet if present.
  return optionalEnv('RECEIPT_ANCHOR_PK') ?? optionalEnv('RELAYER_PK') ?? null;
}

/** True only when both a registry address and a signer key are configured. */
export function isAnchorEnabled(): boolean {
  return Boolean(getRegistryAddress()) && Boolean(anchorPrivateKey());
}

/** True when the background worker should auto-anchor newly issued receipts. */
export function isAnchorAutoEnabled(): boolean {
  return isAnchorEnabled() && optionalEnv('RECEIPT_ANCHOR_AUTO') === 'true';
}

function anchorSigner(): Wallet {
  if (_wallet) return _wallet;
  const pk = anchorPrivateKey();
  if (!pk) throw new Error('receipt_anchor_signer_not_configured');
  _wallet = new Wallet(pk, provider());
  return _wallet;
}

function anchorUri(): string {
  const base = optionalEnv('QANTARA_FRONTEND_URL');
  if (!base) return '';
  const uri = `${base.replace(/\/+$/, '')}/receipt`;
  return Buffer.byteLength(uri, 'utf8') <= MAX_URI_BYTES ? uri : '';
}

export interface AnchorResult {
  txHash: string | null;
  alreadyAnchored: boolean;
}

/**
 * Anchor a single issued receipt. Idempotent: if the registry already has the
 * receipt hash, no transaction is sent. Throws if anchoring is not configured or
 * the on-chain call reverts; callers decide how to record failures.
 */
export async function anchorReceipt(receipt: Receipt): Promise<AnchorResult> {
  const registryAddress = getRegistryAddress();
  if (!registryAddress) throw new Error('receipt_registry_not_configured');
  const contract = new Contract(registryAddress, REGISTRY_ABI, anchorSigner());

  const already = (await contract.isAnchored(receipt.receiptHash)) as boolean;
  if (already) return { txHash: null, alreadyAnchored: true };

  const tx = await contract.anchorReceipt(
    receipt.invoiceHash,
    receipt.receiptHash,
    receipt.txHash,
    receipt.merchant,
    receipt.payer,
    anchorUri(),
  );
  const txReceipt = await tx.wait();
  if (!txReceipt || txReceipt.status !== 1) throw new Error('receipt_anchor_tx_reverted');
  return { txHash: txReceipt.hash as string, alreadyAnchored: false };
}

export function anchorStatusSummary() {
  return {
    enabled: isAnchorEnabled(),
    auto: isAnchorAutoEnabled(),
    registryAddress: getRegistryAddress(),
    signerConfigured: Boolean(anchorPrivateKey()),
  };
}
