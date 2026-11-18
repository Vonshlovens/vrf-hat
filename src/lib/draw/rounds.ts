// How many tickets a round pulls, and when a repeating raffle is finished.
// Pure, so the server and the tests agree.
import type { DrawMode } from "./commitment.ts";

export type RoundRules = {
  mode: DrawMode;
  /** Tickets pulled per draw, when picks are `fixed`. */
  winnerCount: number;
  recurring: boolean;
  /** `eliminate`: a repeating raffle stops when this many names are left. */
  keepCount: number;
  /** `win`: winning tickets go back in the hat. */
  returnPicked: boolean;
  maxDraws: number | null;
  /**
   * `fixed`: every draw pulls `winnerCount`. `spread`: the draws still planned
   * share out what's left to pull (eliminations down to `keepCount`, or
   * `pickTotal` winners) so it comes out exactly on the last planned draw.
   */
  pickPlan: "fixed" | "spread";
  /** `win` + `spread`: winners to pull over the whole raffle. */
  pickTotal: number | null;
};

/** What's in the hat right now. */
export type Hat = {
  /** Tickets still in. */
  tickets: number;
  /** Names with at least one ticket still in. */
  names: number;
};

/** Where a repeating raffle stands against its plan. */
export type PlanContext = {
  /** Draws left in the plan, counting the one being worked out. Null: no known end. */
  draws: number | null;
  /** Tickets pulled so far, over every round. */
  pulled: number;
  /** The host is starting this draw by hand: pull at least one if anything is left to pull. */
  byHand?: boolean;
};

/** Whether a pulled ticket leaves the hat for later rounds. */
export function removesPicked(r: Pick<RoundRules, "mode" | "returnPicked">): boolean {
  return r.mode === "eliminate" || !r.returnPicked;
}

/**
 * Splits `total` picks over `draws` draws as evenly as possible.
 *
 * Leftovers go to the earliest draws, so the last draws pull the fewest and
 * the end stays tense: 10 over 4 is [3, 3, 2, 2]. With fewer picks than
 * draws, the early draws pull nothing (and are skipped) so the last planned
 * draw still lands on the target: 2 over 4 is [0, 0, 1, 1].
 */
export function spread(total: number, draws: number): number[] {
  if (draws <= 0) return [];
  const t = Math.max(0, Math.floor(total));
  if (t < draws) return Array.from({ length: draws }, (_, i) => (i >= draws - t ? 1 : 0));
  const base = Math.floor(t / draws);
  const extra = t % draws;
  return Array.from({ length: draws }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The first share of `spread(total, draws)`, without building the array. */
function firstShare(total: number, draws: number): number {
  if (draws <= 0 || total <= 0) return 0;
  return total < draws ? 0 : Math.ceil(total / draws);
}

/** What a `spread` raffle still has to pull: names to eliminate, or winners to draw. */
export function stillToPull(r: RoundRules, hat: Hat, pulled: number): number {
  if (r.mode === "eliminate") return Math.max(0, hat.names - r.keepCount);
  return Math.max(0, (r.pickTotal ?? 0) - pulled);
}

/**
 * Tickets the next draw pulls; 0 means it can't run.
 *
 * A single draw needs a full hat. A repeating raffle pulls what it can: the
 * last round of a `win` raffle takes whatever is left, and an elimination
 * round never pulls so many that fewer than `keepCount` names could remain.
 * A `spread` raffle with a known number of draws left takes its share.
 */
export function picksFor(r: RoundRules, hat: Hat, ctx?: PlanContext): number {
  if (!r.recurring) return hat.tickets >= r.winnerCount ? r.winnerCount : 0;
  const cap = Math.max(0, r.mode === "eliminate" ? hat.names - r.keepCount : hat.tickets);
  if (r.pickPlan === "spread" && ctx?.draws) {
    const need = stillToPull(r, hat, ctx.pulled);
    let share = firstShare(need, ctx.draws);
    if (ctx.byHand && need > 0) share = Math.max(share, 1);
    return Math.min(share, cap);
  }
  return Math.max(0, Math.min(r.winnerCount, cap));
}

/** After a round: is the raffle over? `ctx.draws` is the draws left in the plan after this one. */
export function isFinished(
  r: RoundRules,
  hatAfter: Hat,
  drawsDone: number,
  ctx?: PlanContext,
): boolean {
  if (!r.recurring) return true;
  if (r.maxDraws !== null && drawsDone >= r.maxDraws) return true;
  if (r.mode === "eliminate") {
    if (hatAfter.names <= r.keepCount) return true;
  } else {
    if (hatAfter.tickets === 0) return true;
    if (r.pickPlan === "spread" && ctx && ctx.pulled >= (r.pickTotal ?? 0)) return true;
  }
  if (ctx?.draws === 0) {
    // The calendar has run out. An elimination that was meant to land on its
    // target but didn't (a name holding several tickets survived a pull)
    // stays open so the host can finish it by hand.
    return !(r.mode === "eliminate" && r.pickPlan === "spread");
  }
  return false;
}

export type PlannedDraw = {
  /** Tickets this draw pulls; 0: it will be skipped. */
  picks: number;
  /** Names left in the hat afterwards. A best case when names hold several tickets. */
  namesLeft: number;
  ticketsLeft: number;
};

/**
 * What each of the next `draws` draws would pull if the hat stayed as it is.
 * The server recomputes this at every draw, so names added or removed in
 * between still land on the target.
 */
export function planDraws(r: RoundRules, hat: Hat, draws: number, pulled = 0): PlannedDraw[] {
  const out: PlannedDraw[] = [];
  let { tickets, names } = hat;
  for (let i = 0; i < draws; i++) {
    const picks = picksFor(r, { tickets, names }, { draws: draws - i, pulled });
    pulled += picks;
    if (removesPicked(r)) {
      tickets -= picks;
      // Exact when every name holds one ticket. Otherwise it's the plan's
      // intent: a pull can hit a name that still has other tickets in, and
      // the next draw's recount makes up for it.
      names = r.mode === "eliminate" ? names - picks : Math.min(names, tickets);
    }
    out.push({ picks, namesLeft: names, ticketsLeft: tickets });
  }
  return out;
}

const COUNT_SUFFIX = /^(.*?)(?:\s+x\s*|\s*[×*]\s*)(\d{1,5})$/i;

/** "Dev Patel x3", "Dev Patel ×3" or "Dev Patel *3" → the name and its ticket count. */
export function parseNameLine(line: string): { label: string; count: number } {
  const m = COUNT_SUFFIX.exec(line.trim());
  if (m && m[1].trim() && Number(m[2]) > 0) return { label: m[1].trim(), count: Number(m[2]) };
  return { label: line.trim(), count: 1 };
}
