// The plain-language view of a verify run: four things a person cares about,
// each with a state, built from the technical steps in run.ts. Pure, so the
// mapping from "what was checked" to "what we tell people" is tested.
import type { CommittedEntrant } from "#lib/draw/commitment.ts";
import type { StepStatus, VerifyResult } from "./run.ts";

/** ok: checked and fine. fail: checked and wrong. run: being checked. wait: Chainlink hasn't answered. skip: nothing to check. */
export type StoryState = "ok" | "fail" | "run" | "wait" | "skip";

export type Story = {
  verdict: StoryState;
  sealed: StoryState;
  random: StoryState;
  pulled: StoryState;
};

function stateOf(status: StepStatus | undefined, running: boolean): StoryState {
  if (status === "pass") return "ok";
  if (status === "fail") return "fail";
  if (status === "skip") return "skip";
  return running ? "run" : "wait";
}

/** Both states at once: the worse one wins. */
function both(a: StoryState, b: StoryState): StoryState {
  const order: StoryState[] = ["fail", "run", "wait", "skip", "ok"];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
}

/**
 * Map run.ts's four technical steps onto the simple story:
 *   sealed ← the list rebuilds the on-chain fingerprint, and that fingerprint
 *            went on-chain with the request for randomness
 *   random ← Chainlink's proof
 *   pulled ← the shuffle
 */
export function buildStory(result: VerifyResult | null, running: boolean): Story {
  const step = (id: string) => result?.steps.find((s) => s.id === id)?.status;
  // A step that never got to run because of an error counts as failed in run.ts.
  const sealed = both(stateOf(step("seal"), running), stateOf(step("request"), running));
  let random = stateOf(step("proof"), running);
  let pulled = stateOf(step("winners"), running);
  // While Chainlink hasn't answered, the shuffle has nothing to work on yet.
  if (random === "wait" && pulled !== "fail") pulled = "wait";
  if (!result) random = pulled = running ? "run" : "wait";

  let verdict: StoryState;
  if (result?.error || [sealed, random, pulled].includes("fail")) verdict = "fail";
  else if (running || !result) verdict = "run";
  else if ([sealed, random, pulled].includes("wait")) verdict = "wait";
  else verdict = "ok";
  return { verdict, sealed, random, pulled };
}

/** "12 seconds", "about 3 minutes", "about 2 hours", "3 days". */
export function gapText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (s < 90) return plural(s, "second");
  const m = Math.round(s / 60);
  if (m < 90) return `about ${plural(m, "minute")}`;
  const h = Math.round(s / 3600);
  if (h < 36) return `about ${plural(h, "hour")}`;
  return `about ${plural(Math.round(s / 86400), "day")}`;
}

/** Ticket number as shown everywhere else in the app: list position + 1, four digits. */
export const ticketNumber = (position: number) => String(position + 1).padStart(4, "0");

/** Positions in the sealed list held by one entry (all of its slots share its ticket). */
export function slotsOf(entrants: readonly CommittedEntrant[], ticket: string): number[] {
  const t = ticket.toLowerCase();
  return entrants.filter((e) => e.ticket.toLowerCase() === t).map((e) => e.index);
}

export type Pull = {
  order: number;
  position: number;
  number: string;
  label: string;
  mine: boolean;
};

/** The pulled tickets, in the order they came out, marking the viewer's own. */
export function pullsOf(
  picks: readonly number[],
  entrants: readonly CommittedEntrant[],
  mine: readonly number[] = [],
): Pull[] {
  const own = new Set(mine);
  return picks.map((position, order) => ({
    order,
    position,
    number: ticketNumber(position),
    label: entrants[position]?.label ?? "?",
    mine: own.has(position),
  }));
}
