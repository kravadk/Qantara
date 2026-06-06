import { describe, it, expect } from 'vitest';
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionExecutionError,
  UserRejectedRequestError,
} from 'viem';
import { describeTxError, txErrorMessage } from './walletErrors';

describe('describeTxError — wallet/RPC/contract edge cases', () => {
  it('classifies an EIP-1193 user rejection (code 4001) as "rejected" without leaking raw text', () => {
    const info = describeTxError({ code: 4001, message: 'MetaMask Tx Signature: User denied transaction signature.' });
    expect(info.kind).toBe('rejected');
    expect(info.message).toMatch(/dismissed the wallet request/i);
  });

  it('classifies an ethers-style ACTION_REJECTED as "rejected"', () => {
    const info = describeTxError({ code: 'ACTION_REJECTED', message: 'user rejected action' });
    expect(info.kind).toBe('rejected');
  });

  it('classifies a viem UserRejectedRequestError chain as "rejected"', () => {
    const err = new BaseError('Request failed', {
      cause: new UserRejectedRequestError(new Error('User rejected the request.')),
    });
    const info = describeTxError(err);
    expect(info.kind).toBe('rejected');
  });

  it('decodes a contract revert reason from a viem ContractFunctionRevertedError', () => {
    const reverted = new ContractFunctionRevertedError({
      abi: [{ type: 'error', name: 'InvoiceExpired', inputs: [] }],
      functionName: 'payInvoiceNative',
      message: 'reverted',
    });
    // Force the decoded reason the way viem surfaces it.
    (reverted as unknown as { reason?: string }).reason = 'InvoiceExpired';
    const err = new ContractFunctionExecutionError(reverted, {
      abi: [],
      functionName: 'payInvoiceNative',
      args: [],
    } as never);
    const info = describeTxError(err);
    expect(info.kind).toBe('reverted');
    expect(info.message).toMatch(/contract rejected this/i);
    expect(info.message).toContain('InvoiceExpired');
  });

  it('classifies insufficient funds as "insufficient_funds"', () => {
    const info = describeTxError(new Error('insufficient funds for gas * price + value'));
    expect(info.kind).toBe('insufficient_funds');
    expect(info.message).toMatch(/not enough qie/i);
  });

  it('classifies a fetch/RPC network failure as "network"', () => {
    expect(describeTxError(new Error('Failed to fetch')).kind).toBe('network');
    expect(describeTxError(new Error('request timed out')).kind).toBe('network');
    expect(describeTxError(new Error('HTTP 503 Service Unavailable')).kind).toBe('network');
    expect(describeTxError(new Error('ECONNREFUSED')).kind).toBe('network');
  });

  it('classifies a generic revert (string "reverted") as "reverted"', () => {
    const info = describeTxError(new Error('execution reverted'));
    expect(info.kind).toBe('reverted');
  });

  it('falls back to "unknown" with the raw message for unrecognised errors', () => {
    const info = describeTxError(new Error('something weird happened'));
    expect(info.kind).toBe('unknown');
    expect(info.message).toContain('something weird happened');
  });

  it('never throws and always returns a non-empty message for odd inputs', () => {
    for (const input of [null, undefined, 42, '', {}, [], 'plain string']) {
      const info = describeTxError(input);
      expect(typeof info.message).toBe('string');
      expect(info.message.length).toBeGreaterThan(0);
      expect(['rejected', 'reverted', 'insufficient_funds', 'network', 'unknown']).toContain(info.kind);
    }
  });

  it('txErrorMessage returns just the friendly string', () => {
    expect(txErrorMessage({ code: 4001 })).toMatch(/dismissed the wallet request/i);
  });
});
