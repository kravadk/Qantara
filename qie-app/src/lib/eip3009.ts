import { parseSignature, toHex, type Address, type Hex } from 'viem';
import { qieMainnet } from '../config/wagmi';
import { QANTARA_ADDRESS, QUSDC_ADDRESS, QUSDC_EIP3009_VERSION } from './dealRoom';

export function makeTransferAuthorizationNonce(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;
}

export function buildTransferAuthorizationTypedData(input: {
  tokenName: string;
  from: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}) {
  return {
    domain: {
      name: input.tokenName,
      version: QUSDC_EIP3009_VERSION,
      chainId: qieMainnet.id,
      verifyingContract: QUSDC_ADDRESS!,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: input.from,
      to: QANTARA_ADDRESS!,
      value: input.value,
      validAfter: input.validAfter,
      validBefore: input.validBefore,
      nonce: input.nonce,
    },
  } as const;
}

export function splitTypedSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const sig = parseSignature(signature);
  return { v: Number(sig.v ?? (27 + Number(sig.yParity ?? 0))), r: sig.r, s: sig.s };
}
