// Repeat schedules. Days and weeks keep the same wall-clock time in the
// raffle's time zone, so a 9:00 weekly draw stays at 9:00 across a
// daylight-saving change. Hours are plain elapsed time.
export type RepeatUnit = "hour" | "day" | "week";
export type Repeat = { every: number; unit: RepeatUnit; timezone: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `tz` at `instant`, as if it were a UTC timestamp. */
function wallClock(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/** The instant at which the clock in `tz` reads `wall` (a UTC-encoded wall time). */
function fromWallClock(wall: number, tz: string): number {
  // Two passes settle the offset on either side of a daylight-saving change.
  let t = wall - (wallClock(wall, tz) - wall);
  t = wall - (wallClock(t, tz) - t);
  return t;
}

/** Parses an `<input type="datetime-local">` value as a time in `tz`. */
export function parseLocalDateTime(value: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wall)) return null;
  return new Date(fromWallClock(wall, tz));
}

/** Formats an instant as an `<input type="datetime-local">` value in `tz`. */
export function toLocalDateTime(at: Date, tz: string): string {
  return new Date(wallClock(at.getTime(), tz)).toISOString().slice(0, 16);
}

function add(at: number, steps: number, r: Repeat): number {
  if (r.unit === "hour") return at + steps * r.every * HOUR;
  const days = steps * r.every * (r.unit === "week" ? 7 : 1);
  return fromWallClock(wallClock(at, r.timezone) + days * DAY, r.timezone);
}

/** The first scheduled time after `now`, counting on from `scheduled`. Missed slots are skipped, not caught up. */
export function nextAfter(scheduled: Date, now: Date, r: Repeat): Date {
  const start = scheduled.getTime();
  if (start > now.getTime()) return scheduled;
  const stepMs = r.every * (r.unit === "hour" ? HOUR : r.unit === "day" ? DAY : 7 * DAY);
  // Jump close, then walk: wall-clock steps can be an hour off elapsed time.
  let steps = Math.max(0, Math.floor((now.getTime() - start) / stepMs) - 1);
  let t = add(start, steps, r);
  while (t <= now.getTime()) t = add(start, ++steps, r);
  return new Date(t);
}

/** "every week", "every 2 days". */
export function describeRepeat(every: number, unit: RepeatUnit): string {
  return every === 1 ? `every ${unit}` : `every ${every} ${unit}s`;
}

/** "Fri 20 Nov, 09:00 GMT-7": a time as the raffle's own zone reads it. */
export function formatWhen(at: Date, tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: at.getUTCFullYear() === now.getUTCFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}
