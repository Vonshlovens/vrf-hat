import { describe, expect, it } from "vite-plus/test";
import type { Calendar } from "./calendar.ts";
import { planRows } from "./plan.ts";
import type { RoundRules } from "./rounds.ts";

const tz = "America/Edmonton";
// Every Wednesday and every second Friday, with no end date.
const cal: Calendar = {
  rules: [
    { weekday: 3, every: 1, start: "2026-11-18", time: "10:10" },
    { weekday: 5, every: 2, start: "2026-11-27", time: "10:10" },
  ],
  dates: [],
  skips: [],
  end: { kind: "none" },
};
const elim: RoundRules = {
  mode: "eliminate",
  winnerCount: 13,
  recurring: true,
  keepCount: 3,
  returnPicked: false,
  maxDraws: null,
  pickPlan: "fixed",
  pickTotal: null,
};
const after = new Date("2026-11-18T17:00:00Z");

describe("planRows", () => {
  it("stops at the draw that brings an elimination down to its keep count", () => {
    const rows = planRows(elim, cal, tz, { tickets: 81, names: 20 }, 0, after);
    expect(rows.map((r) => r.ticketsLeft)).toEqual([68, 55, 42, 29, 16, 3]);
    expect(rows.every((r) => r.picks === 13)).toBe(true);
    expect(rows.map((r) => r.finishes)).toEqual([false, false, false, false, false, true]);
    expect(rows.at(-1)!.at.toISOString()).toBe("2026-12-16T16:10:00.000Z");
  });

  it("does not finish on draws skipped because the hat is empty", () => {
    const win = { ...elim, mode: "win" as const, winnerCount: 1, keepCount: 1 };
    const rows = planRows(win, cal, tz, { tickets: 0, names: 0 }, 0, after);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((r) => r.finishes)).toBe(false);
  });

  it("stops a win raffle when the hat empties", () => {
    const win = { ...elim, mode: "win" as const, winnerCount: 2, keepCount: 1 };
    const rows = planRows(win, cal, tz, { tickets: 5, names: 5 }, 0, after);
    expect(rows.map((r) => r.picks)).toEqual([2, 2, 1]);
    expect(rows.at(-1)!.finishes).toBe(true);
  });
});
