// Reads and validates the raffle forms. Shared by "new raffle" and the
// schedule editor on the raffle page.
import { isBounded, nextPlanned, parseCalendar, type Calendar } from "#lib/draw/calendar.ts";
import { isTimeZone, parseLocalDateTime, type RepeatUnit } from "#lib/draw/schedule.ts";
import { text } from "./form.ts";
import {
  MAX_TICKETS,
  type PickSettings,
  type RaffleSettings,
  type ScheduleSettings,
} from "./raffles.ts";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UNITS: readonly RepeatUnit[] = ["hour", "day", "week"];
const NO_SCHEDULE: ScheduleSettings = {
  repeatEvery: null,
  repeatUnit: null,
  calendar: null,
  timezone: null,
  nextDrawAt: null,
};

const whole = (form: FormData, key: string) => {
  const raw = text(form, key).trim();
  return /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
};

/** The schedule fields, echoed back so a rejected form keeps what was typed. */
export function scheduleValues(form: FormData) {
  return {
    timing: text(form, "timing"),
    firstDrawAt: text(form, "firstDrawAt"),
    repeatEvery: text(form, "repeatEvery"),
    repeatUnit: text(form, "repeatUnit"),
    timezone: text(form, "timezone"),
    calendar: text(form, "calendar"),
    winnerCount: text(form, "winnerCount"),
    pickPlan: text(form, "pickPlan") || "fixed",
    pickTotal: text(form, "pickTotal"),
  };
}

function readCalendar(form: FormData): Parsed<Calendar> {
  let raw: unknown;
  try {
    raw = JSON.parse(text(form, "calendar"));
  } catch {
    return { ok: false, error: "Couldn't read the calendar." };
  }
  return parseCalendar(raw);
}

/**
 * `timing` is "calendar" (weekly rules and dates), "scheduled" (a fixed
 * interval from a first draw) or "manual".
 */
export function parseSchedule(form: FormData, now = new Date()): Parsed<ScheduleSettings> {
  const timezone = text(form, "timezone");
  const timing = text(form, "timing");
  if (timing !== "scheduled" && timing !== "calendar") {
    // Still worth keeping: round times are shown in the host's zone.
    return {
      ok: true,
      value: { ...NO_SCHEDULE, timezone: isTimeZone(timezone) ? timezone : null },
    };
  }
  if (!isTimeZone(timezone)) return { ok: false, error: "Couldn't read your time zone." };

  if (timing === "calendar") {
    const cal = readCalendar(form);
    if (!cal.ok) return cal;
    const nextDrawAt = nextPlanned(cal.value, timezone, now);
    if (!nextDrawAt) return { ok: false, error: "Every date on the calendar has passed." };
    return { ok: true, value: { ...NO_SCHEDULE, calendar: cal.value, timezone, nextDrawAt } };
  }

  const nextDrawAt = parseLocalDateTime(text(form, "firstDrawAt"), timezone);
  if (!nextDrawAt) return { ok: false, error: "Pick a date and time for the next draw." };
  if (nextDrawAt.getTime() < now.getTime() - 60_000) {
    return { ok: false, error: "The next draw has to be in the future." };
  }
  const repeatEvery = whole(form, "repeatEvery");
  const repeatUnit = text(form, "repeatUnit") as RepeatUnit;
  if (!UNITS.includes(repeatUnit)) return { ok: false, error: "Pick hours, days or weeks." };
  if (!(repeatEvery >= 1 && repeatEvery <= 365)) {
    return { ok: false, error: "Repeat every 1 to 365 hours, days or weeks." };
  }
  return { ok: true, value: { ...NO_SCHEDULE, repeatEvery, repeatUnit, timezone, nextDrawAt } };
}

/**
 * How many each draw pulls. `pickPlan` "spread" works the counts out from the
 * calendar, so it needs a calendar with a last date.
 */
export function parsePicks(
  form: FormData,
  r: { mode: string; recurring: boolean; calendar: Calendar | null },
): Parsed<PickSettings> {
  const eliminate = r.mode === "eliminate";
  const winnerCount = whole(form, "winnerCount");
  const fixedOk = winnerCount >= 1 && winnerCount <= 100;
  const spread = r.recurring && text(form, "pickPlan") === "spread";

  if (!spread) {
    if (!fixedOk) {
      return {
        ok: false,
        error: `Pick between 1 and 100 ${eliminate ? "eliminations" : "winners"} per draw.`,
      };
    }
    return { ok: true, value: { winnerCount, pickPlan: "fixed", pickTotal: null } };
  }
  if (!r.calendar || !isBounded(r.calendar)) {
    return { ok: false, error: "To work out the picks for you, the calendar needs an end." };
  }
  let pickTotal: number | null = null;
  if (!eliminate) {
    pickTotal = whole(form, "pickTotal");
    if (!(pickTotal >= 1 && pickTotal <= MAX_TICKETS)) {
      return { ok: false, error: "Say how many winners to draw in all (1 to 10,000)." };
    }
  }
  return {
    ok: true,
    value: { winnerCount: fixedOk ? winnerCount : 1, pickPlan: "spread", pickTotal },
  };
}

export function raffleValues(form: FormData) {
  return {
    title: text(form, "title").trim(),
    description: text(form, "description").trim(),
    mode: text(form, "mode") || "win",
    cadence: text(form, "cadence") || "once",
    maxDraws: text(form, "maxDraws"),
    keepCount: text(form, "keepCount"),
    returnPicked: form.get("returnPicked") === "on",
    selfEntry: form.get("selfEntry") === "on",
    ...scheduleValues(form),
  };
}

const CADENCES = ["once", "calendar", "scheduled", "manual"];

/** `cadence` is "once", "calendar", "scheduled" or "manual". */
export function parseRaffle(form: FormData): Parsed<RaffleSettings> {
  const v = raffleValues(form);
  const fail = (error: string) => ({ ok: false as const, error });

  if (!v.title) return fail("Give the raffle a name.");
  if (v.title.length > 120) return fail("Keep the name under 120 characters.");
  if (v.description.length > 2000) return fail("Keep the description under 2,000 characters.");
  if (v.mode !== "win" && v.mode !== "eliminate") return fail("Pick winners or eliminations.");
  const eliminate = v.mode === "eliminate";

  if (!CADENCES.includes(v.cadence)) return fail("Pick how often to draw.");
  const recurring = v.cadence !== "once";

  form.set("timing", recurring ? v.cadence : "manual");
  const schedule = parseSchedule(form);
  if (!schedule.ok) return schedule;
  const picks = parsePicks(form, { mode: v.mode, recurring, calendar: schedule.value.calendar });
  if (!picks.ok) return picks;

  let maxDraws: number | null = null;
  // A calendar says for itself when it ends.
  if (recurring && v.cadence !== "calendar" && v.maxDraws.trim()) {
    maxDraws = whole(form, "maxDraws");
    if (!(maxDraws >= 1 && maxDraws <= 1000)) return fail("Stop after 1 to 1,000 draws.");
  }
  let keepCount = 1;
  if (recurring && eliminate) {
    keepCount = whole(form, "keepCount");
    if (!(keepCount >= 1 && keepCount <= 1000)) {
      return fail("Say how many names should be left standing (at least 1).");
    }
  }

  return {
    ok: true,
    value: {
      title: v.title,
      description: v.description,
      mode: v.mode,
      selfEntry: v.selfEntry,
      recurring,
      ...schedule.value,
      ...picks.value,
      maxDraws,
      returnPicked: recurring && !eliminate && v.returnPicked,
      keepCount,
    },
  };
}
