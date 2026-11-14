// Reads and validates the raffle forms. Shared by "new raffle" and the
// schedule editor on the raffle page.
import { isTimeZone, parseLocalDateTime, type RepeatUnit } from "#lib/draw/schedule.ts";
import { text } from "./form.ts";
import type { RaffleSettings, ScheduleSettings } from "./raffles.ts";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UNITS: readonly RepeatUnit[] = ["hour", "day", "week"];
const NO_SCHEDULE: ScheduleSettings = {
  repeatEvery: null,
  repeatUnit: null,
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
  };
}

/** `timing` is "scheduled" or "manual". */
export function parseSchedule(form: FormData): Parsed<ScheduleSettings> {
  const timezone = text(form, "timezone");
  if (text(form, "timing") !== "scheduled") {
    // Still worth keeping: round times are shown in the host's zone.
    return {
      ok: true,
      value: { ...NO_SCHEDULE, timezone: isTimeZone(timezone) ? timezone : null },
    };
  }

  if (!isTimeZone(timezone)) return { ok: false, error: "Couldn't read your time zone." };
  const nextDrawAt = parseLocalDateTime(text(form, "firstDrawAt"), timezone);
  if (!nextDrawAt) return { ok: false, error: "Pick a date and time for the next draw." };
  if (nextDrawAt.getTime() < Date.now() - 60_000) {
    return { ok: false, error: "The next draw has to be in the future." };
  }
  const repeatEvery = whole(form, "repeatEvery");
  const repeatUnit = text(form, "repeatUnit") as RepeatUnit;
  if (!UNITS.includes(repeatUnit)) return { ok: false, error: "Pick hours, days or weeks." };
  if (!(repeatEvery >= 1 && repeatEvery <= 365)) {
    return { ok: false, error: "Repeat every 1 to 365 hours, days or weeks." };
  }
  return { ok: true, value: { repeatEvery, repeatUnit, timezone, nextDrawAt } };
}

export function raffleValues(form: FormData) {
  return {
    title: text(form, "title").trim(),
    description: text(form, "description").trim(),
    mode: text(form, "mode") || "win",
    winnerCount: text(form, "winnerCount"),
    cadence: text(form, "cadence") || "once",
    maxDraws: text(form, "maxDraws"),
    keepCount: text(form, "keepCount"),
    returnPicked: form.get("returnPicked") === "on",
    selfEntry: form.get("selfEntry") === "on",
    ...scheduleValues(form),
  };
}

/** `cadence` is "once", "scheduled" or "manual". */
export function parseRaffle(form: FormData): Parsed<RaffleSettings> {
  const v = raffleValues(form);
  const fail = (error: string) => ({ ok: false as const, error });

  if (!v.title) return fail("Give the raffle a name.");
  if (v.title.length > 120) return fail("Keep the name under 120 characters.");
  if (v.description.length > 2000) return fail("Keep the description under 2,000 characters.");
  if (v.mode !== "win" && v.mode !== "eliminate") return fail("Pick winners or eliminations.");
  const eliminate = v.mode === "eliminate";

  const winnerCount = whole(form, "winnerCount");
  if (!(winnerCount >= 1 && winnerCount <= 100)) {
    return fail(`Pick between 1 and 100 ${eliminate ? "eliminations" : "winners"} per draw.`);
  }
  if (!["once", "scheduled", "manual"].includes(v.cadence)) return fail("Pick how often to draw.");
  const recurring = v.cadence !== "once";

  form.set("timing", v.cadence === "scheduled" ? "scheduled" : "manual");
  const schedule = parseSchedule(form);
  if (!schedule.ok) return schedule;

  let maxDraws: number | null = null;
  if (recurring && v.maxDraws.trim()) {
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
      winnerCount,
      selfEntry: v.selfEntry,
      recurring,
      ...schedule.value,
      maxDraws,
      returnPicked: recurring && !eliminate && v.returnPicked,
      keepCount,
    },
  };
}
