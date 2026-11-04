// The entrant-list commitment. This file is the spec: the server builds the
// root with it, the contract stores the root, and the verify page rebuilds it
// in the browser from the published list. Depends only on viem so it runs in
// all three places (and in the Hardhat tests).
import { encodeAbiParameters, keccak256, concat, toBytes, type Hex } from "viem";

export type CommittedEntrant = {
  /** 0-based position in the committed list. Winners are reported as positions. */
  index: number;
  /** Random 16-byte ticket assigned when the entry was made. */
  ticket: Hex;
  /** Display name, normalised with `normalizeLabel`. */
  label: string;
};

export const MAX_LABEL_LENGTH = 64;

/** Canonical form of a display name, so the same name always hashes the same. */
export function normalizeLabel(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

/** On-chain key for a raffle: keccak256("vrf-hat:raffle:" + database id). */
export function raffleKey(raffleId: string): Hex {
  return keccak256(toBytes(`vrf-hat:raffle:${raffleId}`));
}

/**
 * leaf = keccak256(keccak256(abi.encode(uint32 index, bytes16 ticket, string label)))
 *
 * Double hashing keeps a leaf from ever being mistaken for an inner node
 * (the same convention as OpenZeppelin's StandardMerkleTree).
 */
export function entrantLeaf(e: CommittedEntrant): Hex {
  const encoded = encodeAbiParameters(
    [{ type: "uint32" }, { type: "bytes16" }, { type: "string" }],
    [e.index, e.ticket, e.label],
  );
  return keccak256(keccak256(encoded));
}

/** Inner node = keccak256 of the two children in ascending order. */
export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** All tree levels, leaves first. An odd node at the end of a level moves up unchanged. */
export function merkleLevels(leaves: readonly Hex[]): Hex[][] {
  if (leaves.length === 0) throw new Error("cannot commit an empty entrant list");
  const levels: Hex[][] = [[...leaves]];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    levels.push(next);
  }
  return levels;
}

export function merkleRoot(leaves: readonly Hex[]): Hex {
  const levels = merkleLevels(leaves);
  return levels[levels.length - 1][0];
}

/** Sibling hashes from leaf to root, for `RaffleDraw.isCommittedEntrant`. */
export function merkleProof(leaves: readonly Hex[], index: number): Hex[] {
  const proof: Hex[] = [];
  let i = index;
  for (const level of merkleLevels(leaves).slice(0, -1)) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]);
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyMerkleProof(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  return proof.reduce(hashPair, leaf) === root;
}

/** Root of a full list, checking that indices run 0..n-1 in order. */
export function commitmentRoot(entrants: readonly CommittedEntrant[]): Hex {
  entrants.forEach((e, i) => {
    if (e.index !== i) throw new Error(`entrant at position ${i} has index ${e.index}`);
  });
  return merkleRoot(entrants.map(entrantLeaf));
}
