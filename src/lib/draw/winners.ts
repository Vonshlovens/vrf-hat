// Winner selection: a byte-for-byte mirror of RaffleDraw.pickWinners.
import { encodeAbiParameters, keccak256 } from "viem";

/**
 * Partial Fisher–Yates shuffle of [0, n). Step i swaps position i with
 * j = i + keccak256(abi.encode(randomWord, i)) % (n - i). The first k
 * positions, in order, are the winners.
 */
export function pickWinners(randomWord: bigint, n: number, k: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid entrant count ${n}`);
  if (!Number.isInteger(k) || k < 1 || k > n) throw new Error(`invalid winner count ${k}`);
  // Only touched positions are stored; untouched position p still holds p.
  const pool = new Map<number, number>();
  const at = (p: number) => pool.get(p) ?? p;
  const winners: number[] = [];
  for (let i = 0; i < k; i++) {
    const r = BigInt(stepHash(randomWord, i));
    const j = i + Number(r % BigInt(n - i));
    const pi = at(i);
    pool.set(i, at(j));
    pool.set(j, pi);
    winners.push(at(i));
  }
  return winners;
}

/** keccak256(abi.encode(randomWord, i)): the hash used at shuffle step i. */
export function stepHash(randomWord: bigint, i: number) {
  return keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [randomWord, BigInt(i)]),
  );
}
