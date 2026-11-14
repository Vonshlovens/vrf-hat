import { and, asc, count, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { toHex, type Hex } from "viem";
import { PUBLIC_CHAIN_ID, PUBLIC_RAFFLE_CONTRACT } from "$app/env/public";
import { chainInfo } from "#lib/chain/chains.ts";
import {
  commitmentRoot,
  normalizeLabel,
  raffleKey,
  type CommittedEntrant,
} from "#lib/draw/commitment.ts";
import { isFinished, parseNameLine, picksFor, removesPicked, type Hat } from "#lib/draw/rounds.ts";
import { nextAfter } from "#lib/draw/schedule.ts";
import { pickWinners } from "#lib/draw/winners.ts";
import { db } from "./db/index.ts";
import { draw, drawSlot, entry, raffle, type Draw, type Entry, type Raffle } from "./db/schema.ts";
import { drawsEnabled, fulfillWithMock, readDraw, sendDrawRequest } from "./chain.ts";

/** Something the person can fix; the message is shown to them. */
export class RaffleError extends Error {}
/** The hat can't support a draw right now. A scheduled draw skips its slot. */
export class CannotDraw extends RaffleError {}

/** The contract's MAX_ENTRANTS. */
export const MAX_TICKETS = 10_000;
export const MAX_TICKETS_PER_NAME = 1_000;
/** A round whose request never left the server is dropped after this long. */
const ABANDONED_AFTER_MS = 10 * 60_000;

const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function newSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

function newTicket(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export type RaffleSettings = Pick<
  Raffle,
  | "title"
  | "description"
  | "mode"
  | "winnerCount"
  | "selfEntry"
  | "recurring"
  | "repeatEvery"
  | "repeatUnit"
  | "timezone"
  | "nextDrawAt"
  | "maxDraws"
  | "returnPicked"
  | "keepCount"
>;

export async function createRaffle(hostId: string, input: RaffleSettings) {
  const [row] = await db
    .insert(raffle)
    .values({ ...input, hostId, slug: newSlug() })
    .returning();
  return row;
}

export async function getRaffle(slug: string) {
  const [row] = await db.select().from(raffle).where(eq(raffle.slug, slug));
  return row ?? null;
}

export async function rafflesHostedBy(hostId: string) {
  return db
    .select({ raffle, tickets: sql<number>`coalesce(sum(${entry.count}), 0)::int` })
    .from(raffle)
    .leftJoin(entry, eq(entry.raffleId, raffle.id))
    .where(eq(raffle.hostId, hostId))
    .groupBy(raffle.id)
    .orderBy(desc(raffle.createdAt));
}

// ------------------------------------------------------------------ entries

/** Entries in the order they arrived, which is the order they are sealed in. */
export async function listEntries(raffleId: string) {
  return db
    .select()
    .from(entry)
    .where(eq(entry.raffleId, raffleId))
    .orderBy(asc(entry.createdAt), asc(entry.id));
}

/** Tickets this entry still has in the hat. */
export function ticketsLeft(r: Raffle, e: Pick<Entry, "count" | "picked">): number {
  return removesPicked(r) ? Math.max(0, e.count - e.picked) : e.count;
}

async function hatOf(r: Raffle): Promise<Hat> {
  const left = removesPicked(r)
    ? sql`greatest(${entry.count} - ${entry.picked}, 0)`
    : sql`${entry.count}`;
  const [row] = await db
    .select({
      tickets: sql<number>`coalesce(sum(${left}), 0)::int`,
      names: sql<number>`(count(*) filter (where ${left} > 0))::int`,
    })
    .from(entry)
    .where(eq(entry.raffleId, r.id));
  return row;
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function checkEntryId(id: string) {
  if (!UUID.test(id)) throw new RaffleError("That entry no longer exists.");
}

function checkCount(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_TICKETS_PER_NAME) {
    throw new RaffleError(
      `A name can hold between 1 and ${MAX_TICKETS_PER_NAME.toLocaleString("en")} tickets.`,
    );
  }
}

/**
 * Adds a name with `count` tickets. A name the host types again gets the extra
 * tickets added to its existing entry rather than a second row.
 */
export async function addEntry(
  r: Raffle,
  input: { userId: string | null; label: string; count?: number },
) {
  const label = normalizeLabel(input.label);
  if (!label) throw new RaffleError("Enter a name.");
  const n = input.count ?? 1;
  checkCount(n);
  // In each statement the status check and the write are one, so nothing can
  // slip in after the list is sealed.
  const open = sql`exists (select 1 from ${raffle} where id = ${r.id} and status = 'open')`;
  if (input.userId === null) {
    const merged = await db.execute<{ id: string }>(sql`
      update ${entry} set count = least(count + ${n}::int, ${MAX_TICKETS_PER_NAME}::int)
      where id = (
        select id from ${entry}
        where raffle_id = ${r.id} and user_id is null and label = ${label}
        order by created_at, id limit 1)
      and ${open}
      returning id`);
    if (merged.rows.length > 0) return;
  }
  const rows = await db.execute<{ id: string }>(sql`
    insert into ${entry} (raffle_id, user_id, label, ticket, count)
    select ${r.id}, ${input.userId}, ${label}, ${newTicket()}, ${n}::int
    where ${open}
    on conflict do nothing
    returning id`);
  if (rows.rows.length === 0) {
    throw new RaffleError(
      input.userId ? "You're already in this raffle, or it has closed." : "Entries are closed.",
    );
  }
}

/** Names one per line or comma-separated; "Name x3" gives that name three tickets. */
export async function addNames(r: Raffle, text: string) {
  const wanted = new Map<string, number>();
  for (const line of text.split(/\r?\n|,/)) {
    const parsed = parseNameLine(line);
    const label = normalizeLabel(parsed.label);
    if (!label) continue;
    wanted.set(label, (wanted.get(label) ?? 0) + parsed.count);
  }
  if (wanted.size === 0) throw new RaffleError("Enter at least one name.");
  if (wanted.size > 500) throw new RaffleError("Add at most 500 names at a time.");
  for (const n of wanted.values()) checkCount(n);
  let tickets = 0;
  for (const [label, n] of wanted) {
    await addEntry(r, { userId: null, label, count: n });
    tickets += n;
  }
  return { names: wanted.size, tickets };
}

/** Sets how many tickets a name holds. It can't drop below the tickets already pulled. */
export async function setEntryCount(r: Raffle, entryId: string, n: number) {
  checkEntryId(entryId);
  checkCount(n);
  const floor = removesPicked(r) ? sql`greatest(picked, 1)` : sql`1`;
  const rows = await db.execute<{ id: string }>(sql`
    update ${entry} set count = ${n}::int
    where id = ${entryId} and raffle_id = ${r.id} and ${n}::int >= ${floor}
    and exists (select 1 from ${raffle} where id = ${r.id} and status = 'open')
    returning id`);
  if (rows.rows.length === 0) {
    throw new RaffleError(
      r.status === "open"
        ? "That name can't hold fewer tickets than have already been pulled."
        : "Tickets are locked while a draw is under way.",
    );
  }
}

export async function removeEntry(r: Raffle, entryId: string) {
  checkEntryId(entryId);
  if (r.status !== "open") throw new RaffleError("Entries are locked once the draw starts.");
  await db.delete(entry).where(and(eq(entry.id, entryId), eq(entry.raffleId, r.id)));
}

// ------------------------------------------------------------------- rounds

export async function listDraws(raffleId: string) {
  return db.select().from(draw).where(eq(draw.raffleId, raffleId)).orderBy(asc(draw.round));
}

export async function latestDraw(raffleId: string): Promise<Draw | null> {
  const [row] = await db
    .select()
    .from(draw)
    .where(eq(draw.raffleId, raffleId))
    .orderBy(desc(draw.round))
    .limit(1);
  return row ?? null;
}

/** A round's sealed list, exactly as committed. */
export async function committedList(drawId: string): Promise<CommittedEntrant[]> {
  const rows = await db
    .select({ index: drawSlot.position, ticket: drawSlot.ticket, label: drawSlot.label })
    .from(drawSlot)
    .where(eq(drawSlot.drawId, drawId))
    .orderBy(asc(drawSlot.position));
  return rows.map((s) => ({ ...s, ticket: s.ticket as Hex }));
}

/** First and last sealed position of each entry in one round. An entry's tickets sit together. */
export async function slotRanges(drawId: string) {
  const rows = await db
    .select({
      entryId: drawSlot.entryId,
      first: sql<number>`min(${drawSlot.position})::int`,
      last: sql<number>`max(${drawSlot.position})::int`,
    })
    .from(drawSlot)
    .where(and(eq(drawSlot.drawId, drawId), isNotNull(drawSlot.entryId)))
    .groupBy(drawSlot.entryId);
  return new Map(rows.map((s) => [s.entryId!, { first: s.first, last: s.last }]));
}

function pulledSlots(raffleId: string) {
  return db
    .select({
      drawId: drawSlot.drawId,
      position: drawSlot.position,
      entryId: drawSlot.entryId,
      label: drawSlot.label,
      rank: drawSlot.pickedRank,
    })
    .from(drawSlot)
    .innerJoin(draw, eq(draw.id, drawSlot.drawId))
    .where(and(eq(draw.raffleId, raffleId), isNotNull(drawSlot.pickedRank)))
    .orderBy(asc(draw.round), asc(drawSlot.pickedRank));
}

/** Every round with the tickets it pulled, in pull order. */
export async function listRounds(r: Raffle) {
  const draws = await listDraws(r.id);
  let pulled = await pulledSlots(r.id);
  // Draws that predate rounds have a random word but no pulled slots marked.
  const unmarked = draws.filter(
    (d) => d.randomWord && d.entrantCount && !pulled.some((p) => p.drawId === d.id),
  );
  if (unmarked.length > 0) {
    for (const d of unmarked) await markPulled(d, BigInt(d.randomWord!), d.entrantCount!);
    await refreshPicked(r.id);
    pulled = await pulledSlots(r.id);
  }
  return draws.map((d) => ({ draw: d, pulled: pulled.filter((p) => p.drawId === d.id) }));
}

function cantDrawReason(r: Raffle, hat: Hat) {
  if (!r.recurring) {
    const k = r.winnerCount;
    return `Add at least ${k} ${k === 1 ? "ticket" : "tickets"} first.`;
  }
  if (r.mode === "eliminate") {
    const keep = r.keepCount;
    return `An elimination needs more than ${keep} ${keep === 1 ? "name" : "names"} in the hat.`;
  }
  return hat.tickets === 0 ? "The hat is empty." : "There's nothing to draw.";
}

/**
 * Seals the hat as it stands, commits it on-chain, and requests the random
 * word for one round.
 * Order: flip status (stops changes) → write the round and its list → build root → send tx.
 */
export async function startDraw(r: Raffle): Promise<Raffle> {
  if (!PUBLIC_RAFFLE_CONTRACT) throw new RaffleError("Draws aren't configured on this server.");
  if (r.status === "drawn") throw new RaffleError("This raffle has finished.");
  const hat = await hatOf(r);
  if (picksFor(r, hat) === 0) throw new CannotDraw(cantDrawReason(r, hat));
  if (hat.tickets > MAX_TICKETS) {
    throw new CannotDraw(
      `A draw can hold at most ${MAX_TICKETS.toLocaleString("en")} tickets; the hat has ${hat.tickets.toLocaleString("en")}.`,
    );
  }

  const [locked] = await db
    .update(raffle)
    .set({ status: "requested" })
    .where(and(eq(raffle.id, r.id), eq(raffle.status, "open")))
    .returning();
  if (!locked) throw new RaffleError("A draw is already under way, or this raffle has finished.");

  let drawId: string | undefined;
  try {
    const [{ last }] = await db
      .select({ last: sql<number>`coalesce(max(${draw.round}), 0)::int` })
      .from(draw)
      .where(eq(draw.raffleId, r.id));
    const round = last + 1;
    const key = raffleKey(r.id, round, r.mode);
    const [d] = await db
      .insert(draw)
      .values({
        raffleId: r.id,
        round,
        chainId: PUBLIC_CHAIN_ID,
        contractAddress: PUBLIC_RAFFLE_CONTRACT,
        raffleKey: key,
        pickCount: picksFor(r, hat),
      })
      .returning();
    drawId = d.id;

    // One slot per ticket still in the hat, numbered 0..n-1 in arrival order.
    const left = removesPicked(r) ? sql`e.count - e.picked` : sql`e.count`;
    await db.execute(sql`
      insert into ${drawSlot} (draw_id, position, entry_id, ticket, label)
      select ${d.id}::uuid, (row_number() over (order by e.created_at, e.id, g.n)) - 1,
             e.id, e.ticket, e.label
      from ${entry} e cross join lateral generate_series(1, ${left}) as g(n)
      where e.raffle_id = ${r.id}`);
    if (!r.recurring) {
      // An entry whose insert raced the status flip is not part of the only draw.
      await db.execute(sql`
        delete from ${entry} where raffle_id = ${r.id} and not exists (
          select 1 from ${drawSlot} s where s.draw_id = ${d.id}::uuid and s.entry_id = ${entry.id})`);
    }

    // The sealed list is the authority from here on, so size the round from it.
    const committed = await committedList(d.id);
    const sealed: Hat = {
      tickets: committed.length,
      names: new Set(committed.map((c) => c.ticket)).size,
    };
    const picks = picksFor(r, sealed);
    if (picks === 0) throw new CannotDraw(cantDrawReason(r, sealed));
    if (picks !== d.pickCount) {
      await db.update(draw).set({ pickCount: picks }).where(eq(draw.id, d.id));
    }
    const root = commitmentRoot(committed);

    const { txHash, requestId } = await sendDrawRequest(
      { raffleKey: key, root, entrantCount: committed.length, winnerCount: picks },
      async (hash) => {
        await db
          .update(draw)
          .set({
            requestTx: hash,
            entrantsRoot: root,
            entrantCount: committed.length,
            requestedAt: new Date(),
          })
          .where(eq(draw.id, d.id));
      },
    );
    await db
      .update(draw)
      .set({ requestTx: txHash, requestId: requestId.toString() })
      .where(eq(draw.id, d.id));
  } catch (err) {
    // Reopen only if nothing reached the chain.
    const [current] = drawId ? await db.select().from(draw).where(eq(draw.id, drawId)) : [];
    if (!current?.requestTx) await abandonRound(r.id, drawId);
    throw err;
  }

  await advanceSchedule(locked);
  return syncDraw((await getRaffle(r.slug))!);
}

/** Drops a round that never reached the chain and reopens the raffle. */
async function abandonRound(raffleId: string, drawId: string | undefined) {
  if (drawId) await db.delete(draw).where(eq(draw.id, drawId));
  await db
    .update(raffle)
    .set({ status: "open" })
    .where(and(eq(raffle.id, raffleId), eq(raffle.status, "requested")));
}

/** Once a scheduled time has passed, moves the schedule on to its next slot. */
async function advanceSchedule(r: Raffle) {
  const now = new Date();
  if (!r.nextDrawAt || r.nextDrawAt > now) return;
  const next =
    r.recurring && r.repeatEvery && r.repeatUnit
      ? nextAfter(r.nextDrawAt, now, {
          every: r.repeatEvery,
          unit: r.repeatUnit,
          timezone: r.timezone ?? "UTC",
        })
      : null;
  await db.update(raffle).set({ nextDrawAt: next }).where(eq(raffle.id, r.id));
}

/** Marks the slots a random word pulls. Winners are a pure function of the word. */
async function markPulled(d: Draw, word: bigint, entrantCount: number) {
  const pulled = pickWinners(word, entrantCount, d.pickCount);
  const values = sql.join(
    pulled.map((position, rank) => sql`(${position}::int, ${rank}::int)`),
    sql`, `,
  );
  await db.execute(sql`
    update ${drawSlot} s set picked_rank = v.rank
    from (values ${values}) as v(position, rank)
    where s.draw_id = ${d.id}::uuid and s.position = v.position`);
}

/** Recounts how many of each entry's tickets have been pulled. */
async function refreshPicked(raffleId: string) {
  await db.execute(sql`
    update ${entry} set picked = (
      select count(*)::int from ${drawSlot} s
      where s.entry_id = ${entry.id} and s.picked_rank is not null)
    where raffle_id = ${raffleId}`);
}

/**
 * Pulls the current round's on-chain state into the database, and when the
 * random word has landed, reopens or finishes the raffle. Safe to call
 * repeatedly and from several requests at once: every write is a recomputation.
 */
export async function syncDraw(r: Raffle): Promise<Raffle> {
  if (r.status !== "requested") return r;
  const d = await latestDraw(r.id);
  // No pending round yet: startDraw has flipped the status but not written it.
  if (!d || d.randomWord) return r;

  const key = d.raffleKey as Hex;
  let onChain = await readDraw(key);
  if (onChain.requestId === 0n) {
    // Not mined yet. If the request was never even sent, the server died mid-draw.
    if (!d.requestTx && Date.now() - d.createdAt.getTime() > ABANDONED_AFTER_MS) {
      await abandonRound(r.id, d.id);
      return (await getRaffle(r.slug))!;
    }
    return r;
  }

  if (onChain.fulfilledBlock === 0n && chainInfo(PUBLIC_CHAIN_ID).mockCoordinator) {
    await fulfillWithMock(onChain.requestId);
    onChain = await readDraw(key);
  }

  const seen = {
    requestId: onChain.requestId.toString(),
    entrantsRoot: onChain.entrantsRoot,
    entrantCount: onChain.entrantCount,
    pickCount: onChain.winnerCount,
  };
  if (onChain.fulfilledBlock === 0n) {
    if (d.requestId !== seen.requestId) await db.update(draw).set(seen).where(eq(draw.id, d.id));
    return r;
  }

  await markPulled(
    { ...d, pickCount: onChain.winnerCount },
    onChain.randomWord,
    onChain.entrantCount,
  );
  await db
    .update(draw)
    .set({ ...seen, randomWord: onChain.randomWord.toString(), drawnAt: new Date() })
    .where(eq(draw.id, d.id));
  await refreshPicked(r.id);

  const [hat, [{ done }]] = await Promise.all([
    hatOf(r),
    db
      .select({ done: count() })
      .from(draw)
      .where(and(eq(draw.raffleId, r.id), isNotNull(draw.randomWord))),
  ]);
  const finished = isFinished(r, hat, done);
  const [updated] = await db
    .update(raffle)
    .set(finished ? { status: "drawn", nextDrawAt: null } : { status: "open" })
    .where(and(eq(raffle.id, r.id), eq(raffle.status, "requested")))
    .returning();
  return updated ?? (await getRaffle(r.slug))!;
}

// ----------------------------------------------------------------- schedule

export function isDue(r: Raffle, now = new Date()) {
  return r.status === "open" && r.recurring && r.nextDrawAt !== null && r.nextDrawAt <= now;
}

/**
 * Moves one raffle along: collects a pending round's result, or starts a
 * scheduled round whose time has come. A slot the hat can't support is skipped.
 */
export async function tick(r: Raffle): Promise<Raffle> {
  if (r.status === "requested") return syncDraw(r);
  if (!isDue(r) || !drawsEnabled()) return r;
  try {
    return await startDraw(r);
  } catch (err) {
    if (!(err instanceof RaffleError)) throw err;
    if (err instanceof CannotDraw) await advanceSchedule(r);
    return (await getRaffle(r.slug))!;
  }
}

/**
 * The cron entry point: ticks raffles that are waiting on the chain or due.
 * The batches are small because a Worker invocation has a subrequest budget
 * and every query and RPC call spends it; the rest wait for the next minute.
 */
export async function runDue(maxPending = 10, maxDue = 3) {
  const [pending, due] = await Promise.all([
    db
      .select()
      .from(raffle)
      .where(eq(raffle.status, "requested"))
      .orderBy(sql`random()`)
      .limit(maxPending),
    db
      .select()
      .from(raffle)
      .where(
        and(
          eq(raffle.status, "open"),
          eq(raffle.recurring, true),
          lte(raffle.nextDrawAt, new Date()),
        ),
      )
      .orderBy(asc(raffle.nextDrawAt))
      .limit(maxDue),
  ]);
  let failed = 0;
  // One at a time: every request is signed by the same key, so they can't share a nonce.
  for (const r of [...pending, ...due]) {
    try {
      await tick(r);
    } catch (err) {
      failed++;
      console.error(`tick failed for raffle ${r.slug}`, err);
    }
  }
  return { pending: pending.length, due: due.length, failed };
}

export type ScheduleSettings = Pick<
  Raffle,
  "repeatEvery" | "repeatUnit" | "timezone" | "nextDrawAt"
>;

/** Changes when a repeating raffle draws. All null: the host starts each round by hand. */
export async function setSchedule(r: Raffle, schedule: ScheduleSettings) {
  if (!r.recurring) throw new RaffleError("This raffle has a single draw.");
  if (r.status === "drawn") throw new RaffleError("This raffle has finished.");
  await db.update(raffle).set(schedule).where(eq(raffle.id, r.id));
}

/** Finishes a repeating raffle early. Rounds already drawn stand. */
export async function endRaffle(r: Raffle) {
  if (!r.recurring) throw new RaffleError("This raffle has a single draw.");
  const [ended] = await db
    .update(raffle)
    .set({ status: "drawn", nextDrawAt: null })
    .where(and(eq(raffle.id, r.id), eq(raffle.status, "open")))
    .returning();
  if (!ended) throw new RaffleError("Wait for the current draw to finish first.");
}
