import { describe, expect, it } from "vite-plus/test";
import {
  describeCalendar,
  emptyCalendar,
  isBounded,
  nextPlanned,
  occurrences,
  parseCalendar,
  plannedDates,
  remainingDraws,
  type Calendar,
} from "./calendar.ts";
import { isFinished, picksFor, planDraws, spread, type RoundRules } from "./rounds.ts";
import { toLocalDateTime } from "./schedule.ts";

// Past dates, so later changes to time-zone rules can't move them.
const tz = "America/New_York";
const WED = 3;
const FRI = 5;

const cal = (over: Partial<Calendar> = {}): Calendar => ({ ...emptyCalendar(), ...over });
const local = (dates: Date[], zone = tz) => dates.map((d) => toLocalDateTime(d, zone));

describe("calendar expansion", () => {
  it("expands a weekly rule from its first matching day", () => {
    // 2024-10-01 is a Tuesday; the first Wednesday on or after it is the 2nd.
    const c = cal({
      rules: [{ weekday: WED, every: 1, start: "2024-10-01", time: "19:00" }],
      end: { kind: "count", count: 3 },
    });
    expect(local(plannedDates(c, tz))).toEqual([
      "2024-10-02T19:00",
      "2024-10-09T19:00",
      "2024-10-16T19:00",
    ]);
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    // Clocks went back on 2024-11-03 in New York.
    const c = cal({
      rules: [{ weekday: WED, every: 1, start: "2024-10-30", time: "09:00" }],
      end: { kind: "date", date: "2024-11-06" },
    });
    const [a, b] = plannedDates(c, tz);
    expect(local([a, b])).toEqual(["2024-10-30T09:00", "2024-11-06T09:00"]);
    expect(a.toISOString()).toBe("2024-10-30T13:00:00.000Z");
    expect(b.toISOString()).toBe("2024-11-06T14:00:00.000Z");
  });

  it("keeps the wall-clock time when clocks go forward", () => {
    // Europe/London went forward on 2024-03-31.
    const c = cal({
      rules: [{ weekday: 0, every: 1, start: "2024-03-24", time: "12:00" }],
      end: { kind: "count", count: 2 },
    });
    const dates = plannedDates(c, "Europe/London");
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2024-03-24T12:00:00.000Z",
      "2024-03-31T11:00:00.000Z",
    ]);
  });

  it("merges several rules with intervals, one-offs and skips in order", () => {
    const c = cal({
      rules: [
        { weekday: WED, every: 1, start: "2024-10-01", time: "19:00" },
        // Every second Friday from 2024-10-04.
        { weekday: FRI, every: 2, start: "2024-10-04", time: "12:30" },
      ],
      dates: [{ date: "2024-10-12", time: "10:00" }],
      skips: ["2024-10-09"],
      end: { kind: "date", date: "2024-10-20" },
    });
    expect(occurrences(c).planned.map((o) => `${o.date}T${o.time}:${o.source}`)).toEqual([
      "2024-10-02T19:00:rule",
      "2024-10-04T12:30:rule",
      "2024-10-12T10:00:date",
      "2024-10-16T19:00:rule",
      "2024-10-18T12:30:rule",
    ]);
    expect(occurrences(c).skipped).toEqual(["2024-10-09"]);
  });

  it("a count is met after skips, and one-offs come on top", () => {
    const c = cal({
      rules: [{ weekday: WED, every: 1, start: "2024-10-01", time: "19:00" }],
      dates: [{ date: "2024-12-25", time: "08:00" }],
      skips: ["2024-10-09"],
      end: { kind: "count", count: 3 },
    });
    expect(occurrences(c).planned.map((o) => o.date)).toEqual([
      "2024-10-02",
      "2024-10-16",
      "2024-10-23",
      "2024-12-25",
    ]);
  });

  it("drops a duplicate at the same minute", () => {
    const c = cal({
      rules: [{ weekday: WED, every: 1, start: "2024-10-02", time: "19:00" }],
      dates: [{ date: "2024-10-02", time: "19:00" }],
      end: { kind: "count", count: 1 },
    });
    expect(occurrences(c).planned).toHaveLength(1);
  });

  it("knows which plans end", () => {
    const rule = { weekday: WED, every: 1, start: "2024-10-01", time: "19:00" };
    expect(isBounded(cal({ dates: [{ date: "2024-10-02", time: "19:00" }] }))).toBe(true);
    expect(isBounded(cal({ rules: [rule] }))).toBe(false);
    expect(isBounded(cal({ rules: [rule], end: { kind: "count", count: 4 } }))).toBe(true);
    const endless = cal({ rules: [rule] });
    expect(remainingDraws(endless, tz, new Date("2024-10-01T00:00:00Z"))).toBeNull();
    expect(plannedDates(endless, tz)).toHaveLength(1000);
  });

  it("counts and finds what's still to come", () => {
    const c = cal({
      rules: [{ weekday: WED, every: 1, start: "2024-10-01", time: "19:00" }],
      end: { kind: "count", count: 4 },
    });
    // Just after the second draw's time.
    const now = new Date("2024-10-09T23:00:30Z");
    expect(remainingDraws(c, tz, now)).toBe(2);
    expect(toLocalDateTime(nextPlanned(c, tz, now)!, tz)).toBe("2024-10-16T19:00");
    expect(nextPlanned(c, tz, new Date("2025-01-01T00:00:00Z"))).toBeNull();
  });

  it("describes itself", () => {
    expect(
      describeCalendar(
        cal({
          rules: [
            { weekday: WED, every: 1, start: "2024-10-01", time: "19:00" },
            { weekday: FRI, every: 2, start: "2024-10-01", time: "19:00" },
          ],
          dates: [{ date: "2024-10-12", time: "10:00" }],
        }),
      ),
    ).toBe("every Wed and every 2nd Fri, plus 1 date");
  });
});

describe("parseCalendar", () => {
  const ok = {
    rules: [{ weekday: 3, every: 2, start: "2026-12-02", time: "19:00" }],
    dates: [
      { date: "2026-12-24", time: "09:00" },
      { date: "2026-12-20", time: "09:00" },
      { date: "2026-12-20", time: "09:00" },
    ],
    skips: ["2026-12-16", "2026-12-17"],
    end: { kind: "count", count: 4 },
  };

  it("accepts and tidies a calendar", () => {
    const parsed = parseCalendar(ok);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.dates.map((d) => d.date)).toEqual(["2026-12-20", "2026-12-24"]);
    // 12-17 isn't a rule day, so skipping it means nothing.
    expect(parsed.value.skips).toEqual(["2026-12-16"]);
  });

  it("rejects bad input", () => {
    expect(parseCalendar(null).ok).toBe(false);
    expect(parseCalendar({ ...ok, rules: [{ ...ok.rules[0], weekday: 7 }] }).ok).toBe(false);
    expect(parseCalendar({ ...ok, rules: [{ ...ok.rules[0], every: 0 }] }).ok).toBe(false);
    expect(parseCalendar({ ...ok, rules: [{ ...ok.rules[0], time: "25:00" }] }).ok).toBe(false);
    expect(parseCalendar({ ...ok, dates: [{ date: "2026-02-30", time: "09:00" }] }).ok).toBe(false);
    expect(parseCalendar({ ...ok, end: { kind: "count", count: 0 } }).ok).toBe(false);
    expect(parseCalendar({ ...ok, end: { kind: "soon" } }).ok).toBe(false);
    expect(parseCalendar({ rules: [], dates: [], skips: [], end: { kind: "none" } }).ok).toBe(
      false,
    );
  });
});

describe("spreading picks", () => {
  it("splits evenly, extras to the earliest draws", () => {
    expect(spread(10, 4)).toEqual([3, 3, 2, 2]);
    expect(spread(12, 4)).toEqual([3, 3, 3, 3]);
    expect(spread(17, 1)).toEqual([17]);
    expect(spread(5, 0)).toEqual([]);
  });

  it("with fewer picks than draws, skips the early ones so the last lands on target", () => {
    expect(spread(2, 5)).toEqual([0, 0, 0, 1, 1]);
    expect(spread(0, 3)).toEqual([0, 0, 0]);
  });

  const elim = (over: Partial<RoundRules> = {}): RoundRules => ({
    mode: "eliminate",
    winnerCount: 1,
    recurring: true,
    keepCount: 3,
    returnPicked: false,
    maxDraws: null,
    pickPlan: "spread",
    pickTotal: null,
    ...over,
  });

  it("eliminates down to the target exactly on the last draw", () => {
    const plan = planDraws(elim(), { tickets: 20, names: 20 }, 5);
    expect(plan.map((p) => p.picks)).toEqual([4, 4, 3, 3, 3]);
    expect(plan.at(-1)!.ticketsLeft).toBe(3);
  });

  it("re-plans from the hat at every draw", () => {
    const r = elim();
    // 20 names over 5 draws: the first takes 4.
    expect(picksFor(r, { tickets: 20, names: 20 }, { draws: 5, pulled: 0 })).toBe(4);
    // 16 left, then 6 late entries arrive: 22 - 3 = 19 over 4 draws.
    expect(picksFor(r, { tickets: 22, names: 22 }, { draws: 4, pulled: 4 })).toBe(5);
    // Names removed instead: 10 - 3 = 7 over 4.
    expect(picksFor(r, { tickets: 10, names: 10 }, { draws: 4, pulled: 4 })).toBe(2);
    // The last draw always takes everyone down to the target.
    expect(picksFor(r, { tickets: 9, names: 9 }, { draws: 1, pulled: 0 })).toBe(6);
  });

  it("skips draws when there are fewer names than draws", () => {
    const plan = planDraws(elim(), { tickets: 5, names: 5 }, 4);
    expect(plan.map((p) => p.picks)).toEqual([0, 0, 1, 1]);
    expect(plan.at(-1)!.ticketsLeft).toBe(3);
    expect(planDraws(elim(), { tickets: 2, names: 2 }, 3).map((p) => p.picks)).toEqual([0, 0, 0]);
  });

  it("a draw started by hand pulls at least one when there's anyone to pull", () => {
    const r = elim();
    expect(picksFor(r, { tickets: 5, names: 5 }, { draws: 4, pulled: 0 })).toBe(0);
    expect(picksFor(r, { tickets: 5, names: 5 }, { draws: 4, pulled: 0, byHand: true })).toBe(1);
    expect(picksFor(r, { tickets: 3, names: 3 }, { draws: 4, pulled: 0, byHand: true })).toBe(0);
  });

  it("counts tickets (lives), not names, and never cuts below the target", () => {
    // 6 names holding 14 tickets: 11 tickets to go over 2 draws.
    const r = elim();
    expect(picksFor(r, { tickets: 14, names: 6 }, { draws: 2, pulled: 0 })).toBe(6);
    expect(picksFor(r, { tickets: 14, names: 6 }, { draws: 1, pulled: 0 })).toBe(11);
  });

  it("finishes on the target tickets, with at most that many names", () => {
    const r = elim();
    expect(isFinished(r, { tickets: 3, names: 3 }, 5, { draws: 0, pulled: 0 })).toBe(true);
    // Team 7 holds two of the last three tickets: two names left, and that's done.
    expect(isFinished(r, { tickets: 3, names: 2 }, 5, { draws: 0, pulled: 0 })).toBe(true);
    expect(isFinished(r, { tickets: 4, names: 3 }, 5, { draws: 1, pulled: 0 })).toBe(false);
    // Fixed picks finish when the dates do.
    const fixed = elim({ pickPlan: "fixed" });
    expect(isFinished(fixed, { tickets: 6, names: 4 }, 5, { draws: 0, pulled: 0 })).toBe(true);
    expect(isFinished(fixed, { tickets: 6, names: 4 }, 5, { draws: 2, pulled: 0 })).toBe(false);
  });

  it("always lands on the target, however the pulls fall across names", () => {
    // Random hats of multi-ticket names, pulled at random, re-planned each draw
    // the way the server does. The end must be exactly 3 tickets and <= 3 names.
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let trial = 0; trial < 200; trial++) {
      const lives = Array.from(
        { length: 4 + Math.floor(rand() * 30) },
        () => 1 + Math.floor(rand() * 4),
      );
      const draws = 1 + Math.floor(rand() * 12);
      const hat = () => ({
        tickets: lives.reduce((a, b) => a + b, 0),
        names: lives.filter((l) => l > 0).length,
      });
      for (let left = draws; left > 0; left--) {
        let picks = picksFor(elim(), hat(), { draws: left, pulled: 0 });
        while (picks-- > 0) {
          // Pull one random ticket: a name loses a life.
          let k = Math.floor(rand() * hat().tickets);
          const i = lives.findIndex((l) => (k -= l) < 0);
          lives[i]--;
        }
        if (left > 1)
          expect(isFinished(elim(), hat(), draws - left + 1, { draws: left - 1, pulled: 0 })).toBe(
            hat().names <= 1,
          );
      }
      // Every hat starts with at least 4 tickets, so the end is exactly the target.
      expect(hat().tickets).toBe(3);
      expect(hat().names).toBeLessThanOrEqual(3);
      expect(isFinished(elim(), hat(), draws, { draws: 0, pulled: 0 })).toBe(true);
    }
  });

  const win = (over: Partial<RoundRules> = {}): RoundRules => ({
    ...elim({ mode: "win", keepCount: 1, pickTotal: 7 }),
    ...over,
  });

  it("spreads a win raffle's total over the draws", () => {
    const plan = planDraws(win(), { tickets: 50, names: 50 }, 3);
    expect(plan.map((p) => p.picks)).toEqual([3, 2, 2]);
    // Two rounds in, 5 pulled: 2 left over the last draw.
    expect(picksFor(win(), { tickets: 45, names: 45 }, { draws: 1, pulled: 5 })).toBe(2);
    expect(isFinished(win(), { tickets: 43, names: 43 }, 3, { draws: 0, pulled: 7 })).toBe(true);
    expect(isFinished(win(), { tickets: 43, names: 43 }, 2, { draws: 1, pulled: 7 })).toBe(true);
    expect(isFinished(win(), { tickets: 43, names: 43 }, 2, { draws: 1, pulled: 5 })).toBe(false);
  });

  it("never pulls more tickets than the hat holds", () => {
    expect(
      picksFor(win({ pickTotal: 20 }), { tickets: 3, names: 3 }, { draws: 2, pulled: 0 }),
    ).toBe(3);
  });

  it("fixed picks, or spread without a known end, pull the per-draw count", () => {
    expect(picksFor(win({ pickPlan: "fixed", winnerCount: 2 }), { tickets: 9, names: 9 })).toBe(2);
    expect(
      picksFor(win({ winnerCount: 2 }), { tickets: 9, names: 9 }, { draws: null, pulled: 0 }),
    ).toBe(2);
    const plan = planDraws(
      elim({ pickPlan: "fixed", winnerCount: 4 }),
      { tickets: 10, names: 10 },
      3,
    );
    expect(plan.map((p) => p.picks)).toEqual([4, 3, 0]);
  });
});
