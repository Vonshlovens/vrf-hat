import { error, fail, redirect } from "@sveltejs/kit";
import { picksFor } from "#lib/draw/rounds.ts";
import { formatWhen, toLocalDateTime } from "#lib/draw/schedule.ts";
import { drawsEnabled } from "#lib/server/chain.ts";
import { MAX_IMPORT_CHARS, type Columns } from "#lib/import/table.ts";
import { text } from "#lib/server/form.ts";
import {
  RaffleError,
  addEntry,
  addNames,
  importNames,
  MAX_NAMES_PER_ADD,
  MAX_TICKETS,
  MAX_TICKETS_PER_NAME,
  endRaffle,
  listEntries,
  listRounds,
  removeEntry,
  setEntryCount,
  setSchedule,
  slotRanges,
  startDraw,
  syncDraw,
  ticketsLeft,
} from "#lib/server/raffles.ts";
import { orgName, visibleRaffle } from "#lib/server/orgs.ts";
import { parseSchedule } from "#lib/server/settings.ts";
import {
  RecipientError,
  addRecipients,
  hostEmailSettings,
  removeRecipient,
  setEmailOptions,
} from "#lib/server/result-emails.ts";
import type { Actions, PageServerLoad } from "./$types";

const load_ = (slug: string, userId: string | undefined) =>
  visibleRaffle(slug, userId, { next: `/r/${slug}` });

const pad = (n: number) => String(n).padStart(4, "0");

export const load: PageServerLoad = async ({ params, locals }) => {
  let raffle = await load_(params.slug, locals.user?.id);
  if (raffle.status === "requested") {
    raffle = await syncDraw(raffle).catch((err) => {
      console.error("syncDraw failed", err);
      return raffle;
    });
  }
  const [entries, rounds, org] = await Promise.all([
    listEntries(raffle.id),
    listRounds(raffle),
    raffle.organizationId ? orgName(raffle.organizationId) : null,
  ]);
  const userId = locals.user?.id;
  const eliminate = raffle.mode === "eliminate";
  const tz = raffle.timezone ?? "UTC";

  // Ticket numbers: the sealed list while a draw is under way or was the only
  // one; while open, the numbers each name would get if the hat were sealed
  // now. A finished repeating raffle has a different list per round, so none.
  const latest = rounds.at(-1)?.draw;
  const numbered = raffle.status === "open" || raffle.status === "requested" || !raffle.recurring;
  const sealed = raffle.status !== "open" && latest ? await slotRanges(latest.id) : null;
  let next = 0;
  const rows = entries.map((e) => {
    const left = ticketsLeft(raffle, e);
    let range = (numbered && sealed?.get(e.id)) || null;
    if (!sealed && left > 0) {
      range = { first: next, last: next + left - 1 };
      next += left;
    }
    return {
      id: e.id,
      label: e.label,
      count: e.count,
      left,
      picked: e.picked,
      numbers: range
        ? range.first === range.last
          ? pad(range.first + 1)
          : `${pad(range.first + 1)}–${pad(range.last + 1)}`
        : null,
      mine: Boolean(userId && e.userId === userId),
      out: eliminate && left === 0,
    };
  });
  const hat = {
    tickets: rows.reduce((sum, e) => sum + e.left, 0),
    names: rows.filter((e) => e.left > 0).length,
  };

  return {
    raffle: {
      slug: raffle.slug,
      title: raffle.title,
      description: raffle.description,
      mode: raffle.mode,
      winnerCount: raffle.winnerCount,
      selfEntry: raffle.selfEntry,
      status: raffle.status,
      recurring: raffle.recurring,
      repeatEvery: raffle.repeatEvery,
      repeatUnit: raffle.repeatUnit,
      timezone: raffle.timezone,
      nextDrawAt: raffle.nextDrawAt?.toISOString() ?? null,
      nextDrawText: raffle.nextDrawAt ? formatWhen(raffle.nextDrawAt, tz) : null,
      nextDrawLocal: raffle.nextDrawAt ? toLocalDateTime(raffle.nextDrawAt, tz) : "",
      maxDraws: raffle.maxDraws,
      returnPicked: raffle.returnPicked,
      keepCount: raffle.keepCount,
    },
    /** Set when only this organization's members can see the raffle. */
    org,
    isHost: userId === raffle.hostId,
    entered: entries.some((e) => e.userId && e.userId === userId),
    entries: rows,
    hat,
    /** Tickets the next draw would pull; 0 if it can't run yet. */
    nextPicks: picksFor(raffle, hat),
    rounds: rounds.map(({ draw, pulled }) => ({
      round: draw.round,
      done: Boolean(draw.randomWord),
      when: draw.drawnAt ? formatWhen(draw.drawnAt, tz) : null,
      tickets: draw.entrantCount,
      pulled: pulled.map((p) => ({ label: p.label, number: pad(p.position + 1) })),
    })),
    drawsEnabled: drawsEnabled(),
    /** For the import preview; the server checks them again. */
    limits: { perName: MAX_TICKETS_PER_NAME, total: MAX_TICKETS, names: MAX_NAMES_PER_ADD },
    /** Host only: who gets emailed after each round. Holds addresses, so never for anyone else. */
    resultEmails: userId === raffle.hostId ? await hostEmailSettings(raffle) : null,
  };
};

async function hostRaffle(slug: string, userId: string | undefined) {
  const raffle = await load_(slug, userId);
  if (!userId || raffle.hostId !== userId) error(403, "Only the host can do that.");
  return raffle;
}

function handle(err: unknown) {
  if (err instanceof RaffleError) return fail(400, { error: err.message });
  if (err instanceof RecipientError) return fail(400, { emailError: err.message });
  throw err;
}

export const actions: Actions = {
  enter: async ({ params, locals, request }) => {
    if (!locals.user) redirect(303, `/login?next=/r/${params.slug}`);
    const raffle = await load_(params.slug, locals.user.id);
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
      return { added: await addNames(raffle, text(await request.formData(), "names")) };
    } catch (err) {
      return handle(err);
    }
  },

  importNames: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    const form = await request.formData();
    const file = form.get("file");
    let table = text(form, "table");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMPORT_CHARS) {
        return fail(400, { error: "That file is too big; import at most 1 MB." });
      }
      table = await file.text();
    }
    // The columns the host picked. Anything missing falls back to the server's own guess.
    const choice: Partial<Columns> = {};
    const header = text(form, "header");
    if (header) choice.header = header === "1";
    const name = text(form, "nameCol");
    if (name) choice.name = Number(name);
    if (form.has("countCol")) {
      const count = text(form, "countCol");
      choice.count = count === "" ? null : Number(count);
    }
    try {
      return { imported: await importNames(raffle, table, choice) };
    } catch (err) {
      return handle(err);
    }
  },

  setCount: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    const form = await request.formData();
    try {
      await setEntryCount(raffle, text(form, "id"), Number(text(form, "count")));
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

  schedule: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    const parsed = parseSchedule(await request.formData());
    if (!parsed.ok) return fail(400, { error: parsed.error });
    try {
      await setSchedule(raffle, parsed.value);
    } catch (err) {
      return handle(err);
    }
    return { scheduled: true };
  },

  addRecipients: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    try {
      await addRecipients(raffle, locals.user!.id, text(await request.formData(), "emails"));
    } catch (err) {
      return handle(err);
    }
    return { emailsSaved: true };
  },

  removeRecipient: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    await removeRecipient(raffle, text(await request.formData(), "email"));
  },

  emailOptions: async ({ params, locals, request }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    const form = await request.formData();
    await setEmailOptions(raffle, {
      emailHost: form.get("emailHost") === "on",
      emailMembers: form.get("emailMembers") === "on",
    });
    return { emailsSaved: true };
  },

  end: async ({ params, locals }) => {
    const raffle = await hostRaffle(params.slug, locals.user?.id);
    try {
      await endRaffle(raffle);
    } catch (err) {
      return handle(err);
    }
  },
};
