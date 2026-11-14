import { fail, redirect } from "@sveltejs/kit";
import { createRaffle } from "#lib/server/raffles.ts";
import { parseRaffle, raffleValues } from "#lib/server/settings.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) redirect(303, "/login?next=/new");
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) redirect(303, "/login?next=/new");
    const form = await request.formData();
    const parsed = parseRaffle(form);
    if (!parsed.ok) return fail(400, { ...raffleValues(form), error: parsed.error });
    const raffle = await createRaffle(locals.user.id, parsed.value);
    redirect(303, `/r/${raffle.slug}`);
  },
};
