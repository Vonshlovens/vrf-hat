// Calendar schedules: weekly rules ("every second Friday at 19:00"), one-off
// dates and skipped dates, expanded into the draw times they plan. All dates
// and times are wall-clock values in the raffle's time zone, so a 19:00 draw
// stays at 19:00 across a daylight-saving change. Pure, so the server, the
// calendar editor and the tests agree.
import { parseLocalDateTime } from "./schedule.ts";

/** A repeating weekly draw. */
export type WeeklyRule = {
  /** 0 = Sunday … 6 = Saturday, as `Date.getUTCDay()`. */
  weekday: number;
  /** Every 1st, 2nd, 3rd… week, counted from the first matching day on or after `start`. */
  every: number;
  /** `YYYY-MM-DD`. */
  start: string;
  /** `HH:MM`. */
  time: string;
};

/** A single extra draw. */
export type OneOff = { date: string; time: string };

/**
 * When the weekly rules stop. One-off dates are always part of the plan.
 * `none`: the rules repeat until the raffle finishes on its own (hat empty, or
 * only the names to keep are left).
 */
export type CalendarEnd =
  | { kind: "date"; date: string }
  | { kind: "count"; count: number }
  | { kind: "none" };

export type Calendar = {
  rules: WeeklyRule[];
  dates: OneOff[];
  /** `YYYY-MM-DD` days on which a rule's draw is dropped. */
  skips: string[];
  end: CalendarEnd;
};

export const MAX_RULES = 8;
export const MAX_ONE_OFFS = 200;
export const MAX_SKIPS = 400;
export const MAX_WEEKS_APART = 12;
/** No plan holds more draws than this; an endless one is cut off here. */
export const MAX_PLANNED = 1000;

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Day number (days since 1970-01-01) of a `YYYY-MM-DD` string, or NaN. */
export function dayNumber(date: string): number {
  const m = DATE.exec(date);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Rejects 2026-02-30 and friends.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return NaN;
  }
  return ms / DAY_MS;
}

export function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}

export const emptyCalendar = (): Calendar => ({
  rules: [],
  dates: [],
  skips: [],
  end: { kind: "none" },
});

/** Where the editor starts: weekly from tomorrow's weekday at 19:00, six draws. */
export function starterCalendar(today: string): Calendar {
  return {
    rules: [{ weekday: weekdayOf(dayNumber(today) + 1), every: 1, start: today, time: "19:00" }],
    dates: [],
    skips: [],
    end: { kind: "count", count: 6 },
  };
}

/** Whether the plan has a last draw. Only then can picks be spread to land on a target. */
export function isBounded(cal: Calendar): boolean {
  return cal.rules.length === 0 || cal.end.kind !== "none";
}

export type Occurrence = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`. */
  time: string;
  source: "rule" | "date";
};

/** First day on or after `start` that falls on `weekday`. */
function firstOn(start: number, weekday: number): number {
  return start + ((weekday - weekdayOf(start) + 7) % 7);
}

/**
 * Every planned draw as a wall-clock date and time, in order, plus the rule
 * days that were skipped. Two draws at the same minute count once.
 */
export function occurrences(cal: Calendar): { planned: Occurrence[]; skipped: string[] } {
  const skips = new Set(cal.skips);
  const endDay = cal.end.kind === "date" ? dayNumber(cal.end.date) : Infinity;
  // A count only needs that many rule draws per rule, plus any that get skipped.
  const perRule =
    cal.end.kind === "count" ? Math.min(cal.end.count, MAX_PLANNED) + skips.size : MAX_PLANNED;

  const fromRules: Occurrence[] = [];
  const skipped = new Set<string>();
  for (const rule of cal.rules) {
    const start = dayNumber(rule.start);
    if (Number.isNaN(start)) continue;
    let day = firstOn(start, rule.weekday);
    for (let n = 0; n < perRule && day <= endDay; n++, day += 7 * rule.every) {
      const date = dayString(day);
      if (skips.has(date)) skipped.add(date);
      else fromRules.push({ date, time: rule.time, source: "rule" });
    }
  }
  const key = (o: Occurrence) => `${o.date}T${o.time}`;
  fromRules.sort((a, b) => key(a).localeCompare(key(b)));
  const rules =
    cal.end.kind === "count" ? dedupe(fromRules, key).slice(0, cal.end.count) : fromRules;
  // Skipped days past the count's cut-off didn't push anything into the plan.
  const lastRule = rules.at(-1)?.date;
  const skippedInPlan = [...skipped].filter(
    (d) => cal.end.kind !== "count" || (lastRule !== undefined && d <= lastRule),
  );

  const all = [...rules, ...cal.dates.map((d) => ({ ...d, source: "date" as const }))];
  all.sort((a, b) => key(a).localeCompare(key(b)) || (a.source === "date" ? 1 : -1));
  return {
    planned: dedupe(all, key).slice(0, MAX_PLANNED),
    skipped: skippedInPlan.sort(),
  };
}

function dedupe<T>(sorted: T[], key: (t: T) => string): T[] {
  return sorted.filter((t, i) => i === 0 || key(sorted[i - 1]) !== key(t));
}

/** The instant of a wall-clock date and time in `tz`. */
export function instantOf(o: Pick<Occurrence, "date" | "time">, tz: string): Date {
  return parseLocalDateTime(`${o.date}T${o.time}`, tz)!;
}

/** Every planned draw time, in order. Pass `after` for only the ones still to come. */
export function plannedDates(cal: Calendar, tz: string, after?: Date): Date[] {
  const dates = occurrences(cal).planned.map((o) => instantOf(o, tz));
  dates.sort((a, b) => a.getTime() - b.getTime());
  return after ? dates.filter((d) => d > after) : dates;
}

/** The first planned draw after `now`, or null when the plan has run out. */
export function nextPlanned(cal: Calendar, tz: string, now: Date): Date | null {
  return plannedDates(cal, tz, now)[0] ?? null;
}

/** Planned draws still to come after `now`; null for an endless plan. */
export function remainingDraws(cal: Calendar, tz: string, now: Date): number | null {
  return isBounded(cal) ? plannedDates(cal, tz, now).length : null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Checks a calendar sent by the editor and puts it in canonical form: skips
 * that don't land on a rule's day are dropped, one-offs are sorted and unique.
 */
export function parseCalendar(raw: unknown): Parsed<Calendar> {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isObject(raw)) return fail("Couldn't read the calendar.");
  const { rules, dates, skips, end } = raw;
  if (!Array.isArray(rules) || !Array.isArray(dates) || !Array.isArray(skips) || !isObject(end)) {
    return fail("Couldn't read the calendar.");
  }
  if (rules.length > MAX_RULES) return fail(`Use at most ${MAX_RULES} weekly rules.`);
  if (dates.length > MAX_ONE_OFFS) return fail(`Add at most ${MAX_ONE_OFFS} single dates.`);
  if (skips.length > MAX_SKIPS) return fail(`Skip at most ${MAX_SKIPS} dates.`);

  const cal = emptyCalendar();
  for (const r of rules) {
    if (!isObject(r)) return fail("Couldn't read a weekly rule.");
    const { weekday, every, start, time } = r;
    if (!Number.isInteger(weekday) || (weekday as number) < 0 || (weekday as number) > 6) {
      return fail("Pick a day of the week for each rule.");
    }
    if (!Number.isInteger(every) || (every as number) < 1 || (every as number) > MAX_WEEKS_APART) {
      return fail(`Weekly rules repeat every 1 to ${MAX_WEEKS_APART} weeks.`);
    }
    if (typeof start !== "string" || Number.isNaN(dayNumber(start))) {
      return fail("Give each weekly rule a start date.");
    }
    if (typeof time !== "string" || !TIME.test(time)) return fail("Give each rule a time of day.");
    cal.rules.push({ weekday: weekday as number, every: every as number, start, time });
  }
  for (const d of dates) {
    if (!isObject(d)) return fail("Couldn't read a date.");
    if (typeof d.date !== "string" || Number.isNaN(dayNumber(d.date))) {
      return fail("One of the dates isn't a real day.");
    }
    if (typeof d.time !== "string" || !TIME.test(d.time)) return fail("Give each date a time.");
    cal.dates.push({ date: d.date, time: d.time });
  }
  const key = (o: OneOff) => `${o.date}T${o.time}`;
  cal.dates = dedupe(
    cal.dates.sort((a, b) => key(a).localeCompare(key(b))),
    key,
  );

  if (end.kind === "date") {
    if (typeof end.date !== "string" || Number.isNaN(dayNumber(end.date))) {
      return fail("Pick the date the repeats end.");
    }
    cal.end = { kind: "date", date: end.date };
  } else if (end.kind === "count") {
    if (!Number.isInteger(end.count) || (end.count as number) < 1) {
      return fail("Repeat for at least one draw.");
    }
    if ((end.count as number) > MAX_PLANNED) return fail(`Plan at most ${MAX_PLANNED} draws.`);
    cal.end = { kind: "count", count: end.count as number };
  } else if (end.kind !== "none") {
    return fail("Say when the repeats end.");
  }

  // Keep only skips that remove a rule's draw.
  const wanted = new Set(skips.filter((s): s is string => typeof s === "string"));
  cal.skips = [...wanted].sort();
  cal.skips = occurrences(cal).skipped;

  if (occurrences(cal).planned.length === 0) return fail("The calendar has no draw dates yet.");
  return { ok: true, value: cal };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
}

/** "every Wed", "every 2nd Fri". */
export function describeRule(r: Pick<WeeklyRule, "weekday" | "every">): string {
  return r.every === 1
    ? `every ${WEEKDAYS[r.weekday]}`
    : `every ${ordinal(r.every)} ${WEEKDAYS[r.weekday]}`;
}

/** "every Wed and every 2nd Fri, plus 2 dates". */
export function describeCalendar(cal: Calendar): string {
  const parts = cal.rules.map(describeRule);
  const rules =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const n = cal.dates.length;
  const dates = n === 1 ? "1 date" : `${n} dates`;
  if (!rules) return `on ${dates}`;
  return n ? `${rules}, plus ${dates}` : rules;
}
