import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { toHex, type Hex } from "viem";
import { PUBLIC_CHAIN_ID, PUBLIC_RAFFLE_CONTRACT } from "$app/env/public";
import { chainInfo } from "#lib/chain/chains.ts";
import {
  commitmentRoot,
  normalizeLabel,
  raffleKey,
  type CommittedEntrant,
} from "#lib/draw/commitment.ts";
import { pickWinners } from "#lib/draw/winners.ts";
import { db } from "./db/index.ts";
import { entry, raffle, type Entry, type Raffle } from "./db/schema.ts";
import { fulfillWithMock, readDraw, sendDrawRequest } from "./chain.ts";

export class RaffleError extends Error {}

const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function newSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

function newTicket(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function createRaffle(
  hostId: string,
  input: { title: string; description: string; winnerCount: number; selfEntry: boolean },
) {
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
    .select({ raffle, entrants: count(entry.id) })
    .from(raffle)
    .leftJoin(entry, eq(entry.raffleId, raffle.id))
    .where(eq(raffle.hostId, hostId))
    .groupBy(raffle.id)
    .orderBy(desc(raffle.createdAt));
}

/** Entries in committed order once drawn; in entry order while open. */
export async function listEntries(raffleId: string) {
  return db
    .select()
    .from(entry)
    .where(eq(entry.raffleId, raffleId))
    .orderBy(sql`${entry.position} asc nulls last`, asc(entry.createdAt), asc(entry.id));
}

export async function addEntry(r: Raffle, input: { userId: string | null; label: string }) {
  const label = normalizeLabel(input.label);
  if (!label) throw new RaffleError("Enter a name.");
  // The status check and insert are one statement, so an entry can't slip in
  // after the raffle closes.
  const rows = await db.execute<{ id: string }>(sql`
    insert into ${entry} (raffle_id, user_id, label, ticket)
    select ${r.id}, ${input.userId}, ${label}, ${newTicket()}
    where exists (select 1 from ${raffle} where id = ${r.id} and status = 'open')
    on conflict do nothing
    returning id`);
  if (rows.rows.length === 0) {
    throw new RaffleError(
      input.userId ? "You're already in this raffle, or it has closed." : "Entries are closed.",
    );
  }
}

export async function addNames(r: Raffle, text: string) {
  const names = text
    .split(/\r?\n|,/)
    .map(normalizeLabel)
    .filter(Boolean);
  if (names.length === 0) throw new RaffleError("Enter at least one name.");
  if (names.length > 500) throw new RaffleError("Add at most 500 names at a time.");
  for (const label of names) await addEntry(r, { userId: null, label });
  return names.length;
}

export async function removeEntry(r: Raffle, entryId: string) {
  if (r.status !== "open") throw new RaffleError("Entries are locked once the draw starts.");
  await db.delete(entry).where(and(eq(entry.id, entryId), eq(entry.raffleId, r.id)));
}

export function toCommitted(entries: Entry[]): CommittedEntrant[] {
  return entries
    .filter((e) => e.position !== null)
    .sort((a, b) => a.position! - b.position!)
    .map((e) => ({ index: e.position!, ticket: e.ticket as Hex, label: e.label }));
}

/**
 * Closes entries, commits the list on-chain, and requests the random word.
 * Order: flip status (stops new entries) → number entries → build root → send tx.
 */
export async function startDraw(r: Raffle) {
  if (!PUBLIC_RAFFLE_CONTRACT) throw new RaffleError("Draws aren't configured on this server.");
  const [{ n }] = await db.select({ n: count() }).from(entry).where(eq(entry.raffleId, r.id));
  if (n < r.winnerCount) {
    throw new RaffleError(
      `Add at least ${r.winnerCount} ${r.winnerCount === 1 ? "entry" : "entries"} first.`,
    );
  }
  if (n > 10_000) throw new RaffleError("A raffle can have at most 10,000 entries.");

  const key = raffleKey(r.id);
  const [locked] = await db
    .update(raffle)
    .set({
      status: "requested",
      chainId: PUBLIC_CHAIN_ID,
      contractAddress: PUBLIC_RAFFLE_CONTRACT,
      raffleKey: key,
    })
    .where(and(eq(raffle.id, r.id), eq(raffle.status, "open")))
    .returning();
  if (!locked) throw new RaffleError("This raffle has already been drawn.");

  try {
    // Number entries 0..n-1 in the order they arrived.
    await db.execute(sql`
      update ${entry} set position = ranked.rn
      from (select id, (row_number() over (order by created_at, id)) - 1 as rn
            from ${entry} where raffle_id = ${r.id}) as ranked
      where ${entry}.id = ranked.id`);
    // An entry whose insert raced the status flip is not part of the draw.
    await db.delete(entry).where(and(eq(entry.raffleId, r.id), isNull(entry.position)));
    const committed = toCommitted(await listEntries(r.id));
    const root = commitmentRoot(committed);

    const { txHash, requestId } = await sendDrawRequest(
      { raffleKey: key, root, entrantCount: committed.length, winnerCount: r.winnerCount },
      async (hash) => {
        await db
          .update(raffle)
          .set({
            requestTx: hash,
            entrantsRoot: root,
            entrantCount: committed.length,
            requestedAt: new Date(),
          })
          .where(eq(raffle.id, r.id));
      },
    );
    await db
      .update(raffle)
      .set({ requestTx: txHash, requestId: requestId.toString() })
      .where(eq(raffle.id, r.id));
  } catch (err) {
    // Reopen only if nothing reached the chain.
    const [current] = await db.select().from(raffle).where(eq(raffle.id, r.id));
    if (!current?.requestTx) {
      await db.update(entry).set({ position: null }).where(eq(entry.raffleId, r.id));
      await db
        .update(raffle)
        .set({ status: "open", chainId: null, contractAddress: null, raffleKey: null })
        .where(eq(raffle.id, r.id));
    }
    throw err;
  }
  return syncDraw((await getRaffle(r.slug))!);
}

/** Pulls the draw's on-chain state into the database. Safe to call repeatedly. */
export async function syncDraw(r: Raffle): Promise<Raffle> {
  if (r.status !== "requested" || !r.raffleKey) return r;
  const key = r.raffleKey as Hex;
  let draw = await readDraw(key);
  if (draw.requestId === 0n) return r; // tx not mined yet

  if (draw.fulfilledBlock === 0n && chainInfo(PUBLIC_CHAIN_ID).mockCoordinator) {
    await fulfillWithMock(draw.requestId);
    draw = await readDraw(key);
  }

  const patch: Partial<Raffle> = { requestId: draw.requestId.toString() };
  if (draw.fulfilledBlock !== 0n) {
    Object.assign(patch, {
      status: "drawn",
      randomWord: draw.randomWord.toString(),
      drawnAt: new Date(),
    });
  }
  const [updated] = await db.update(raffle).set(patch).where(eq(raffle.id, r.id)).returning();
  return updated;
}

/** Winners in winning order, or null before the draw. */
export function winnersOf(r: Raffle, entries: Entry[]) {
  if (r.status !== "drawn" || !r.randomWord || !r.entrantCount) return null;
  return pickWinners(BigInt(r.randomWord), r.entrantCount, r.winnerCount).map((i) => ({
    position: i,
    entry: entries.find((e) => e.position === i)!,
  }));
}
