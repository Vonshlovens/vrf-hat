// Statistical checks that pickWinners behaves like pulling tickets from a hat
// one at a time, without putting them back. Seeds are fixed, so these are
// deterministic: a failure means the odds changed, not bad luck.
import { describe, expect, it } from "vite-plus/test";
import { pickWinners } from "./winners.ts";

/** Chi-square critical value at p = 0.001 (Wilson–Hilferty approximation). */
function critical(df: number): number {
  const z = 3.0902;
  const a = 2 / (9 * df);
  return df * (1 - a + z * Math.sqrt(a)) ** 3;
}

function chiSquare(observed: number[], expected: number): number {
  return observed.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0);
}

// A word per trial; pickWinners hashes (word, step), so consecutive words are fine.
const word = (trial: number) => BigInt(trial) * 0x9e3779b97f4a7c15n + 1n;

describe("pickWinners odds", () => {
  // A hat of 8 tickets: positions 0–2 belong to one name ("A"), 3–7 to five
  // names with one ticket each.
  const n = 8;
  const isA = (p: number) => p < 3;
  const trials = 28_000;
  const pairs = Array.from({ length: trials }, (_, t) => pickWinners(word(t), n, 2));

  it("every ticket is equally likely on the first pull", () => {
    const first = Array<number>(n).fill(0);
    for (const [a] of pairs) first[a]++;
    expect(chiSquare(first, trials / n)).toBeLessThan(critical(n - 1));
  });

  it("every ordered pair of distinct tickets is equally likely", () => {
    const cells = new Map<string, number>();
    for (const [a, b] of pairs) {
      expect(a).not.toBe(b);
      cells.set(`${a},${b}`, (cells.get(`${a},${b}`) ?? 0) + 1);
    }
    const df = n * (n - 1);
    expect(cells.size).toBe(df);
    expect(chiSquare([...cells.values()], trials / df)).toBeLessThan(critical(df - 1));
  });

  it("a name is less likely to be pulled right after one of its tickets is pulled", () => {
    let aFirst = 0;
    let aThenA = 0;
    let otherFirst = 0;
    let otherThenA = 0;
    for (const [a, b] of pairs) {
      if (isA(a)) {
        aFirst++;
        if (isA(b)) aThenA++;
      } else {
        otherFirst++;
        if (isA(b)) otherThenA++;
      }
    }
    // Like a real hat: A holds 3 of 8 tickets, so 3/8 on the first pull.
    expect(aFirst / trials).toBeCloseTo(3 / 8, 1);
    // After one of A's tickets comes out, A has 2 of the 7 left...
    expect(Math.abs(aThenA / aFirst - 2 / 7)).toBeLessThan(0.02);
    // ...and after someone else's comes out, A has 3 of the 7 left.
    expect(Math.abs(otherThenA / otherFirst - 3 / 7)).toBeLessThan(0.02);
  });

  it("a one-ticket name can't be pulled again once it's out", () => {
    for (let t = 0; t < 2_000; t++) {
      const order = pickWinners(word(t), 10, 10);
      expect(new Set(order).size).toBe(10);
    }
  });

  it("a full draw is a uniformly random order", () => {
    const m = 4;
    const perms = 24;
    const runs = 12_000;
    const cells = new Map<string, number>();
    for (let t = 0; t < runs; t++) {
      const key = pickWinners(word(t + 1_000_000), m, m).join("");
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    expect(cells.size).toBe(perms);
    expect(chiSquare([...cells.values()], runs / perms)).toBeLessThan(critical(perms - 1));
  });
});
