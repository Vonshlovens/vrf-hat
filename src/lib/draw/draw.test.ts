import { describe, expect, it } from "vite-plus/test";
import { keccak256, toBytes, toHex } from "viem";
import {
  commitmentRoot,
  entrantLeaf,
  merkleProof,
  merkleRoot,
  normalizeLabel,
  raffleKey,
  verifyMerkleProof,
} from "./commitment.ts";
import { isFinished, parseNameLine, picksFor, type RoundRules } from "./rounds.ts";
import { nextAfter, parseLocalDateTime, toLocalDateTime } from "./schedule.ts";
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

describe("raffleKey", () => {
  const id = "3f0c2f4e-9f0b-4f0e-8a51-3f1f6f3f9d11";

  it("keeps the original key for round 1 of a win raffle", () => {
    expect(raffleKey(id)).toBe(keccak256(toBytes(`vrf-hat:raffle:${id}`)));
    expect(raffleKey(id, 1, "win")).toBe(raffleKey(id));
  });

  it("differs by round and by mode", () => {
    const keys = [
      raffleKey(id, 1, "win"),
      raffleKey(id, 2, "win"),
      raffleKey(id, 1, "eliminate"),
      raffleKey(id, 2, "eliminate"),
    ];
    expect(new Set(keys).size).toBe(4);
  });
});

describe("rounds", () => {
  const rules = (over: Partial<RoundRules> = {}): RoundRules => ({
    mode: "win",
    winnerCount: 2,
    recurring: false,
    keepCount: 1,
    returnPicked: false,
    maxDraws: null,
    ...over,
  });

  it("a single draw needs enough tickets and then finishes", () => {
    expect(picksFor(rules(), { tickets: 1, names: 1 })).toBe(0);
    expect(picksFor(rules(), { tickets: 5, names: 3 })).toBe(2);
    expect(isFinished(rules(), { tickets: 3, names: 2 }, 1)).toBe(true);
  });

  it("a repeating win raffle takes what's left, then finishes on an empty hat", () => {
    const r = rules({ recurring: true });
    expect(picksFor(r, { tickets: 1, names: 1 })).toBe(1);
    expect(isFinished(r, { tickets: 1, names: 1 }, 3)).toBe(false);
    expect(isFinished(r, { tickets: 0, names: 0 }, 4)).toBe(true);
  });

  it("an elimination never cuts below the names to keep", () => {
    const r = rules({ mode: "eliminate", recurring: true, winnerCount: 3, keepCount: 2 });
    expect(picksFor(r, { tickets: 9, names: 6 })).toBe(3);
    expect(picksFor(r, { tickets: 9, names: 4 })).toBe(2);
    expect(picksFor(r, { tickets: 9, names: 2 })).toBe(0);
    expect(isFinished(r, { tickets: 9, names: 2 }, 1)).toBe(true);
    expect(isFinished(r, { tickets: 9, names: 3 }, 1)).toBe(false);
  });

  it("stops after the draw limit", () => {
    const r = rules({ recurring: true, returnPicked: true, maxDraws: 2 });
    expect(isFinished(r, { tickets: 9, names: 9 }, 1)).toBe(false);
    expect(isFinished(r, { tickets: 9, names: 9 }, 2)).toBe(true);
  });

  it("reads ticket counts off name lines", () => {
    expect(parseNameLine("Dev Patel x3")).toEqual({ label: "Dev Patel", count: 3 });
    expect(parseNameLine("Dev Patel ×12")).toEqual({ label: "Dev Patel", count: 12 });
    expect(parseNameLine("Dev*2")).toEqual({ label: "Dev", count: 2 });
    expect(parseNameLine("Alex3")).toEqual({ label: "Alex3", count: 1 });
    expect(parseNameLine("Max")).toEqual({ label: "Max", count: 1 });
    expect(parseNameLine("x3")).toEqual({ label: "x3", count: 1 });
  });
});

describe("schedule", () => {
  // Past dates, so later changes to time-zone rules can't move them.
  const tz = "America/New_York";

  it("round-trips local date-times", () => {
    const at = parseLocalDateTime("2024-11-20T09:00", tz)!;
    expect(at.toISOString()).toBe("2024-11-20T14:00:00.000Z");
    expect(toLocalDateTime(at, tz)).toBe("2024-11-20T09:00");
    expect(parseLocalDateTime("nope", tz)).toBeNull();
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    // Clocks went back on 2024-11-03 in New York.
    const first = parseLocalDateTime("2024-10-30T09:00", tz)!;
    const next = nextAfter(first, first, { every: 1, unit: "week", timezone: tz });
    expect(toLocalDateTime(next, tz)).toBe("2024-11-06T09:00");
    expect(next.getTime() - first.getTime()).toBe(7 * 24 * 3_600_000 + 3_600_000);
  });

  it("skips missed slots instead of catching up", () => {
    const first = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-10T12:30:00Z");
    const daily = nextAfter(first, now, { every: 2, unit: "day", timezone: "UTC" });
    expect(daily.toISOString()).toBe("2026-01-11T00:00:00.000Z");
    const hourly = nextAfter(first, now, { every: 6, unit: "hour", timezone: "UTC" });
    expect(hourly.toISOString()).toBe("2026-01-10T18:00:00.000Z");
  });

  it("leaves a future time alone", () => {
    const first = new Date("2026-03-01T00:00:00Z");
    const now = new Date("2026-01-01T00:00:00Z");
    expect(nextAfter(first, now, { every: 1, unit: "day", timezone: "UTC" })).toEqual(first);
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
