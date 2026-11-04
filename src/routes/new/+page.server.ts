import { fail, redirect } from "@sveltejs/kit";
import { text } from "#lib/server/form.ts";
import { createRaffle } from "#lib/server/raffles.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, "/login?next=/new");
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) redirect(303, "/login?next=/new");
    const form = await request.formData();
    const title = text(form, "title").trim();
    const description = text(form, "description").trim();
    const winnerCount = Number(form.get("winnerCount"));
    const selfEntry = form.get("selfEntry") === "on";
    const values = {
      title,
      description,
      winnerCount: text(form, "winnerCount"),
      selfEntry,
    };

    if (!title) return fail(400, { ...values, error: "Give the raffle a name." });
    if (title.length > 120)
      return fail(400, { ...values, error: "Keep the name under 120 characters." });
    if (description.length > 2000)
      return fail(400, { ...values, error: "Keep the description under 2,000 characters." });
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 100) {
      return fail(400, { ...values, error: "Pick between 1 and 100 winners." });
    }

    const raffle = await createRaffle(locals.user.id, {
      title,
      description,
      winnerCount,
      selfEntry,
    });
    redirect(303, `/r/${raffle.slug}`);
  },
};
