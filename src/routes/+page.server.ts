import { rafflesHostedBy } from "#lib/server/raffles.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => ({
  hosted: locals.user ? await rafflesHostedBy(locals.user.id) : [],
});
