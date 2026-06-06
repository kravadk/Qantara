/**
 * Minimal keccak256 Merkle tree — used for invoice-existence proofs.
 *
 * Pairs are hashed in sorted order, so the tree and its proofs are verifiable
 * by OpenZeppelin's `MerkleProof` library and by `PayrollAnchor.verify()`
 * on-chain. Leaves are invoice hashes (already `bytes32`), so a proof shows an
 * invoice was part of an anchored batch without revealing amount or parties.
 */

import { keccak256, concat, type Hex } from 'viem';

const ZERO_ROOT = ('0x' + '0'.repeat(64)) as Hex;

/** Hash a pair of nodes in sorted order (OpenZeppelin-compatible). */
function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() <= b.toLowerCase()
    ? keccak256(concat([a, b]))
    : keccak256(concat([b, a]));
}

export interface MerkleTree {
  root: Hex;
  /** Deduplicated, lower-cased, sorted leaves. */
  leaves: Hex[];
  /** layers[0] = leaves, last layer = [root]. */
  layers: Hex[][];
}

/** Build a Merkle tree from a set of `bytes32` leaves (e.g. invoice hashes). */
export function buildMerkleTree(rawLeaves: Hex[]): MerkleTree {
  const leaves = [...new Set(rawLeaves.map((l) => l.toLowerCase() as Hex))].sort();
  if (leaves.length === 0) return { root: ZERO_ROOT, leaves, layers: [[]] };

  const layers: Hex[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      // Odd node is promoted unchanged to the next layer.
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return { root: layers[layers.length - 1][0], leaves, layers };
}

/** Sibling path proving `leaf` is in the tree, or `null` if it is not present. */
export function getMerkleProof(tree: MerkleTree, leaf: Hex): Hex[] | null {
  let index = tree.leaves.indexOf(leaf.toLowerCase() as Hex);
  if (index < 0) return null;

  const proof: Hex[] = [];
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const layer = tree.layers[l];
    const siblingIndex = index ^ 1;
    if (siblingIndex < layer.length) proof.push(layer[siblingIndex]);
    index = Math.floor(index / 2);
  }
  return proof;
}

/** Recompute the root from `leaf` + `proof` and check it matches `root`. */
export function verifyMerkleProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed = leaf.toLowerCase() as Hex;
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}
