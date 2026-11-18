// The calendar's draws with what each one pulls, for the editor's preview
// and the raffle page. Pure, so both show what the server will do.
import { isBounded, plannedDates, type Calendar } from "./calendar.ts";
import { planDraws, type Hat, type RoundRules } from "./rounds.ts";

export type PlanRow = {
  at: Date;
  /** Tickets pulled; 0: the draw will be skipped. */
  picks: number;
  namesLeft: number;
  /** "4 out · 16 left", "3 winners", "skipped". */
  text: string;
};

/** The draws still to come after `now`, with their pick counts if the hat stays as it is. */
export function planRows(
  r: RoundRules,
  cal: Calendar,
  tz: string,
  hat: Hat,
  pulled: number,
  now: Date,
): PlanRow[] {
  const dates = plannedDates(cal, tz, now);
  // An endless plan has no last draw to aim at: every draw pulls the fixed count.
  const rules = isBounded(cal) ? r : { ...r, pickPlan: "fixed" as const };
  const draws = planDraws(rules, hat, dates.length, pulled);
  const multi = hat.tickets !== hat.names;
  return dates.map((at, i) => {
    const { picks, namesLeft } = draws[i];
    return { at, picks, namesLeft, text: pickText(r.mode, picks, namesLeft, multi) };
  });
}

export function pickText(
  mode: RoundRules["mode"],
  picks: number,
  namesLeft: number,
  multiTicket = false,
): string {
  if (picks === 0) return "skipped";
  if (mode === "win") return picks === 1 ? "1 winner" : `${picks} winners`;
  const out = multiTicket ? `${picks} ${picks === 1 ? "ticket" : "tickets"} out` : `${picks} out`;
  return `${out} · ${namesLeft} left`;
}

/** "Wed 3 Dec" (with the year when it isn't this year's). */
export function formatDay(at: Date, tz: string, now = new Date()): string {
  const year = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric" }).format(d);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: year(at) === year(now) ? undefined : "numeric",
  }).format(at);
}

/** "19:00". */
export function formatTime(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}
