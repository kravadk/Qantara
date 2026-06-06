/**
 * Single source of truth for turning wallet / RPC / contract errors into
 * friendly, categorised messages. Every writeContract / sendTransaction /
 * signTypedData / signMessage / fetch catch block should route through
 * describeTxError so nothing fails silently and reverts are decoded.
 */
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';

export type TxErrorKind =
  | 'rejected'          // user dismissed the wallet prompt
  | 'reverted'          // contract reverted (decoded reason when available)
  | 'insufficient_funds'// not enough gas / balance
  | 'network'           // RPC unreachable / timeout / HTTP error
  | 'unknown';

export interface TxErrorInfo {
  kind: TxErrorKind;
  /** Short, user-facing message. */
  message: string;
}

function rawMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { shortMessage?: unknown; message?: unknown };
    if (typeof e.shortMessage === 'string' && e.shortMessage) return e.shortMessage;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return typeof err === 'string' && err ? err : 'Unexpected error';
}

function looksRejected(err: unknown): boolean {
  const e = err as { code?: unknown; name?: unknown } | null;
  const code = e?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  const text = rawMessage(err).toLowerCase();
  return text.includes('user rejected') || text.includes('user denied') || text.includes('rejected the request') || text.includes('request rejected');
}

/**
 * Decode a thrown error from a wallet/RPC/contract call into a friendly message
 * and a coarse category. Handles viem BaseError chains (revert reasons, user
 * rejection) as well as plain wagmi/ethers-style error objects.
 */
export function describeTxError(err: unknown): TxErrorInfo {
  // viem rich errors first — walk the cause chain.
  if (err instanceof BaseError) {
    const rejected = err.walk((e) => e instanceof UserRejectedRequestError);
    if (rejected || looksRejected(err)) {
      return { kind: 'rejected', message: 'You dismissed the wallet request. Nothing was sent — try again when ready.' };
    }
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const reason = reverted.reason || reverted.data?.errorName || reverted.shortMessage;
      return { kind: 'reverted', message: reason ? `The contract rejected this: ${reason}` : 'The contract rejected this transaction.' };
    }
    const text = err.shortMessage || err.message;
    const lower = text.toLowerCase();
    if (lower.includes('insufficient funds')) {
      return { kind: 'insufficient_funds', message: 'Not enough QIE to cover the amount plus gas.' };
    }
    if (lower.includes('reverted')) {
      return { kind: 'reverted', message: text };
    }
    return { kind: 'unknown', message: text };
  }

  if (looksRejected(err)) {
    return { kind: 'rejected', message: 'You dismissed the wallet request. Nothing was sent — try again when ready.' };
  }

  const text = rawMessage(err);
  const lower = text.toLowerCase();
  if (lower.includes('insufficient funds') || lower.includes('insufficient balance')) {
    return { kind: 'insufficient_funds', message: 'Not enough QIE to cover the amount plus gas.' };
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    lower.includes('econn') ||
    /\bhttp \d{3}\b/.test(lower)
  ) {
    return { kind: 'network', message: 'Network or RPC is not responding. Check your connection and retry.' };
  }
  if (lower.includes('reverted')) {
    return { kind: 'reverted', message: text };
  }
  return { kind: 'unknown', message: text };
}

/** Convenience: just the friendly message string. */
export function txErrorMessage(err: unknown): string {
  return describeTxError(err).message;
}
