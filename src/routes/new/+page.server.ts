import { fail, redirect } from "@sveltejs/kit";
import { text } from "#lib/server/form.ts";
import { memberRole, orgsOf } from "#lib/server/orgs.ts";
import { createRaffle } from "#lib/server/raffles.ts";
import { parseRaffle, raffleValues } from "#lib/server/settings.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) redirect(303, "/login?next=/new");
  const orgs = await orgsOf(locals.user.id);
  return {
    orgs: orgs.map(({ id, name }) => ({ id, name })),
    /** `?org=<slug>` from an organization's page preselects it. */
    preselect: orgs.find((o) => o.slug === url.searchParams.get("org"))?.id ?? "",
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) redirect(303, "/login?next=/new");
    const form = await request.formData();
    const audience = text(form, "audience");
    const values = { ...raffleValues(form), audience };
    const parsed = parseRaffle(form);
    if (!parsed.ok) return fail(400, { ...values, error: parsed.error });
    if (audience && !(await memberRole(audience, locals.user.id))) {
      return fail(400, { ...values, error: "You're not in that organization." });
    }
    const raffle = await createRaffle(locals.user.id, parsed.value, audience || null);
    redirect(303, `/r/${raffle.slug}`);
  },
};
