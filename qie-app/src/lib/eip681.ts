import { parseUnits, type Address } from 'viem';

export interface BuildEip681Input {
  /** Recipient address (merchant or token holder). */
  to: Address;
  /** Decimal amount string (e.g. "1.5"). Optional — omit for "any amount" link. */
  amount?: string;
  /** ERC-20 token address. Omit / zero address → native chain currency. */
  token?: Address;
  /** Chain ID. Defaults to QIE Mainnet (1990). */
  chainId?: number;
  /** Token decimals. Required if `token` is set and `amount` is provided. Default 18. */
  decimals?: number;
}

const ZERO = '0x0000000000000000000000000000000000000000' as const;

/**
 * Build an EIP-681 payment URI suitable for QR codes and `ethereum:` deep-links.
 *
 * Native QIE:    `ethereum:0xRecipient@1990?value=1500000000000000000`
 * ERC-20:        `ethereum:0xToken@1990/transfer?address=0xRecipient&uint256=1500000`
 *
 * Most major wallets (MetaMask Mobile, Rainbow, Trust, Coinbase Wallet) auto-pop
 * a pre-filled send screen from these URIs.
 * Reference: https://eips.ethereum.org/EIPS/eip-681
 */
export function buildEip681({
  to,
  amount,
  token,
  chainId = 1990,
  decimals = 18,
}: BuildEip681Input): string {
  const isNative = !token || token === ZERO;
  const target = isNative ? to : token;
  const base = `ethereum:${target}@${chainId}`;

  if (!amount) return isNative ? base : `${base}/transfer?address=${to}`;

  if (isNative) {
    const wei = parseUnits(amount, decimals).toString();
    return `${base}?value=${wei}`;
  }

  const units = parseUnits(amount, decimals).toString();
  return `${base}/transfer?address=${to}&uint256=${units}`;
}

/**
 * Build a fallback web URL for opening the Qantara pay page in any browser
 * (cards, share sheet, no wallet installed).
 */
export function buildPayWebUrl(invoiceHash: string, frontendBase?: string): string {
  const base =
    frontendBase ??
    (typeof window !== 'undefined' ? window.location.origin : 'https://mainnet.qie.digital');
  return `${base.replace(/\/$/, '')}/pay/${invoiceHash}`;
}

export interface QantaraLinkInput {
  to: Address;
  amount?: string;
  token?: Address;
  chainId?: number;
  decimals?: number;
  invoiceHash?: string;
  label?: string;
  message?: string;
  expiry?: number;
}

/**
 * Build the canonical Qantara payment link (`qantara://pay?...`) — the portable,
 * wallet-agnostic standard any app can generate. Mirrors the @qie/qantara-sdk
 * `buildQantaraLink` so links stay interoperable.
 */
export function buildQantaraLink({ to, amount, token, chainId = 1990, decimals, invoiceHash, label, message, expiry }: QantaraLinkInput): string {
  const params = new URLSearchParams();
  params.set('v', '1');
  params.set('to', to.toLowerCase());
  params.set('chain', String(chainId));
  if (token && token !== ZERO) params.set('token', token.toLowerCase());
  if (amount) params.set('amount', amount);
  if (decimals !== undefined) params.set('decimals', String(decimals));
  if (invoiceHash) params.set('hash', invoiceHash.toLowerCase());
  if (label) params.set('label', label);
  if (message) params.set('message', message);
  if (expiry) params.set('expiry', String(expiry));
  return `qantara://pay?${params.toString()}`;
}
