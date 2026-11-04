import { describe, expect, it } from "vite-plus/test";
import { toHex } from "viem";
import {
  commitmentRoot,
  entrantLeaf,
  merkleProof,
  merkleRoot,
  normalizeLabel,
  verifyMerkleProof,
} from "./commitment.ts";
import { pickWinners } from "./winners.ts";

const list = (n: number) =>
  Array.from({ length: n }, (_, index) => ({
    index,
    ticket: toHex(BigInt(index + 7), { size: 16 }),
    label: `E${index}`,
  }));

describe("commitment", () => {
  it("proves every leaf for many list sizes", () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = list(n).map(entrantLeaf);
      const root = merkleRoot(leaves);
      leaves.forEach((leaf, i) =>
        expect(verifyMerkleProof(leaf, merkleProof(leaves, i), root)).toBe(true),
      );
    }
  });

  it("changes the root when any label changes", () => {
    const entrants = list(9);
    const root = commitmentRoot(entrants);
    entrants[4] = { ...entrants[4], label: "E4 " };
    expect(commitmentRoot(entrants)).not.toBe(root);
  });

  it("rejects out-of-order indices", () => {
    expect(() => commitmentRoot([list(2)[1]])).toThrow();
  });

  it("normalises labels", () => {
    expect(normalizeLabel("  Dev \n  Patel ")).toBe("Dev Patel");
  });
});

describe("pickWinners", () => {
  it("is deterministic and picks distinct in-range positions", () => {
    const a = pickWinners(123456789n, 50, 10);
    expect(pickWinners(123456789n, 50, 10)).toEqual(a);
    expect(new Set(a).size).toBe(10);
    expect(a.every((w) => w >= 0 && w < 50)).toBe(true);
  });

  it("with k = n, returns a permutation", () => {
    expect([...pickWinners(42n, 12, 12)].sort((x, y) => x - y)).toEqual([...Array(12).keys()]);
  });
});
