// How many tickets a round pulls, and when a repeating raffle is finished.
// Pure, so the server and the tests agree.
import type { DrawMode } from "./commitment.ts";

export type RoundRules = {
  mode: DrawMode;
  /** Tickets pulled per draw. */
  winnerCount: number;
  recurring: boolean;
  /** `eliminate`: a repeating raffle stops when this many names are left. */
  keepCount: number;
  /** `win`: winning tickets go back in the hat. */
  returnPicked: boolean;
  maxDraws: number | null;
};

/** What's in the hat right now. */
export type Hat = {
  /** Tickets still in. */
  tickets: number;
  /** Names with at least one ticket still in. */
  names: number;
};

/** Whether a pulled ticket leaves the hat for later rounds. */
export function removesPicked(r: Pick<RoundRules, "mode" | "returnPicked">): boolean {
  return r.mode === "eliminate" || !r.returnPicked;
}

/**
 * Tickets the next draw pulls; 0 means it can't run.
 *
 * A single draw needs a full hat. A repeating raffle pulls what it can: the
 * last round of a `win` raffle takes whatever is left, and an elimination
 * round never pulls so many that fewer than `keepCount` names could remain.
 */
export function picksFor(r: RoundRules, hat: Hat): number {
  if (!r.recurring) return hat.tickets >= r.winnerCount ? r.winnerCount : 0;
  const cap = r.mode === "eliminate" ? hat.names - r.keepCount : hat.tickets;
  return Math.max(0, Math.min(r.winnerCount, cap));
}

/** After a round: is the raffle over? */
export function isFinished(r: RoundRules, hatAfter: Hat, drawsDone: number): boolean {
  if (!r.recurring) return true;
  if (r.maxDraws !== null && drawsDone >= r.maxDraws) return true;
  return picksFor(r, hatAfter) === 0;
}

const COUNT_SUFFIX = /^(.*?)(?:\s+x\s*|\s*[×*]\s*)(\d{1,5})$/i;

/** "Dev Patel x3", "Dev Patel ×3" or "Dev Patel *3" → the name and its ticket count. */
export function parseNameLine(line: string): { label: string; count: number } {
  const m = COUNT_SUFFIX.exec(line.trim());
  if (m && m[1].trim() && Number(m[2]) > 0) return { label: m[1].trim(), count: Number(m[2]) };
  return { label: line.trim(), count: 1 };
}
