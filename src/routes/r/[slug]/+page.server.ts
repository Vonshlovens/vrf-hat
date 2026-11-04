import { error, fail, redirect } from "@sveltejs/kit";
import { drawsEnabled } from "#lib/server/chain.ts";
import { text } from "#lib/server/form.ts";
import {
  RaffleError,
  addEntry,
  addNames,
  getRaffle,
  listEntries,
  removeEntry,
  startDraw,
  syncDraw,
  winnersOf,
} from "#lib/server/raffles.ts";
import type { Actions, PageServerLoad } from "./$types";

async function load_(slug: string) {
  const raffle = await getRaffle(slug);
  if (!raffle) error(404, "No raffle at this address.");
  return raffle;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  let raffle = await load_(params.slug);
  if (raffle.status === "requested") {
    raffle = await syncDraw(raffle).catch((err) => {
      console.error("syncDraw failed", err);
      return raffle;
    });
  }
  const entries = await listEntries(raffle.id);
  const winners = winnersOf(raffle, entries);
  const winnerIds = new Set(winners?.map((w) => w.entry.id));
  const userId = locals.user?.id;

  return {
    raffle: {
      slug: raffle.slug,
      title: raffle.title,
      description: raffle.description,
      winnerCount: raffle.winnerCount,
      selfEntry: raffle.selfEntry,
      status: raffle.status,
      requestTx: raffle.requestTx,
      chainId: raffle.chainId,
    },
    isHost: userId === raffle.hostId,
    entered: entries.some((e) => e.userId && e.userId === userId),
    entries: entries.map((e, i) => ({
      id: e.id,
      label: e.label,
      number: (e.position ?? i) + 1,
      mine: Boolean(userId && e.userId === userId),
      won: winnerIds.has(e.id),
    })),
    winners: winners?.map((w) => ({ label: w.entry.label, number: w.position + 1 })) ?? null,
    drawsEnabled: drawsEnabled(),
  };
};

async function hostRaffle(slug: string, userId: string | undefined) {
  const raffle = await load_(slug);
  if (!userId || raffle.hostId !== userId) error(403, "Only the host can do that.");
  return raffle;
}

function handle(err: unknown) {
  if (err instanceof RaffleError) return fail(400, { error: err.message });
  throw err;
}

export const actions: Actions = {
  enter: async ({ params, locals, request }) => {
    if (!locals.user) redirect(303, `/login?next=/r/${params.slug}`);
    const raffle = await load_(params.slug);
    if (!raffle.selfEntry && raffle.hostId !== locals.user.id) {
      return fail(400, { error: "The host adds names for this raffle." });
    }
    const label = text(await request.formData(), "label") || locals.user.name;
    try {
      await addEntry(raffle, { userId: locals.user.id, label });
    } catch (err) {
      return handle(err);
    }
    return { entered: true };
  },

  addNames: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    try {
      const added = await addNames(raffle, text(await request.formData(), "names"));
      return { added };
    } catch (err) {
      return handle(err);
    }
  },

  remove: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    try {
      await removeEntry(raffle, text(await request.formData(), "id"));
    } catch (err) {
      return handle(err);
    }
  },

  draw: async ({ params, locals }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    try {
      await startDraw(raffle);
    } catch (err) {
      if (err instanceof RaffleError) return handle(err);
      console.error("startDraw failed", err);
      return fail(502, {
        error: "The draw request didn't reach the blockchain. Nothing was recorded; try again.",
      });
    }
  },
};
