import { keccak256, toBytes, toHex, encodePacked, type Address, type Hex } from 'viem';

/**
 * Lightweight obfuscation — NOT real cryptography.
 *
 * XORs the message with keccak256(min(a,b) || max(a,b)). Both parties derive
 * the same key from the sorted pair, but anyone who knows both addresses can
 * decrypt — and the addresses are public on every Message event. So this is
 * privacy-theater, sufficient only to prove the encrypt/decrypt UX loop.
 *
 * For Phase I we'll either ship real ECDH (curve25519 pubkey registration tx)
 * or label messages as plaintext-public with a clear banner.
 */
function deriveSharedKey(a: Address, b: Address): Uint8Array {
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return toBytes(keccak256(encodePacked(['address', 'address'], [lo, hi])));
}

function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

export function encryptMessage(plaintext: string, from: Address, to: Address): Hex {
  const key = deriveSharedKey(from, to);
  const data = new TextEncoder().encode(plaintext);
  return toHex(xorBytes(data, key));
}

export function decryptMessage(ciphertext: Hex, from: Address, to: Address): string {
  const key = deriveSharedKey(from, to);
  const data = toBytes(ciphertext);
  const plain = xorBytes(data, key);
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(plain);
  } catch {
    return '⟨undecodable⟩';
  }
}
