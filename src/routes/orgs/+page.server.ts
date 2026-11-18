import { fail, redirect } from "@sveltejs/kit";
import { auth } from "#lib/server/auth.ts";
import { text } from "#lib/server/form.ts";
import { authMessage, orgsOf } from "#lib/server/orgs.ts";
import { newSlug } from "#lib/server/raffles.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, request }) => {
  if (!locals.user) redirect(303, "/login?next=/orgs");
  const [orgs, invitations] = await Promise.all([
    orgsOf(locals.user.id),
    // Needs a verified email; an unverified account just sees none.
    auth.api.listUserInvitations({ headers: request.headers }).catch(() => []),
  ]);
  return {
    orgs,
    invitations: invitations.map((i) => ({ id: i.id, orgName: i.organizationName })),
  };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    if (!locals.user) redirect(303, "/login?next=/orgs");
    const name = text(await request.formData(), "name")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) return fail(400, { name, error: "Give the organization a name." });
    if (name.length > 80) return fail(400, { name, error: "Keep the name under 80 characters." });
    let slug: string;
    try {
      const org = await auth.api.createOrganization({
        body: { name, slug: newSlug() },
        headers: request.headers,
      });
      slug = org!.slug;
    } catch (err) {
      const message = authMessage(err);
      if (message) return fail(400, { name, error: message });
      throw err;
    }
    redirect(303, `/orgs/${slug}`);
  },
};
