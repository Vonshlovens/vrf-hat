import { fail, redirect } from "@sveltejs/kit";
import { auth } from "#lib/server/auth.ts";
import { authMessage } from "#lib/server/orgs.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals, request }) => {
  if (!locals.user) redirect(303, `/login?next=/invite/${params.id}`);
  try {
    const inv = await auth.api.getInvitation({
      query: { id: params.id },
      headers: request.headers,
    });
    return {
      invitation: {
        orgName: inv.organizationName,
        orgSlug: inv.organizationSlug,
        inviter: inv.inviterEmail,
        role: inv.role,
      },
      problem: null,
      signedInAs: locals.user.email,
    };
  } catch (err) {
    const message = authMessage(err);
    if (!message) throw err;
    return { invitation: null, problem: message, signedInAs: locals.user.email };
  }
};

export const actions: Actions = {
  accept: async ({ params, locals, request }) => {
    if (!locals.user) redirect(303, `/login?next=/invite/${params.id}`);
    let slug: string;
    try {
      const inv = await auth.api.getInvitation({
        query: { id: params.id },
        headers: request.headers,
      });
      slug = inv.organizationSlug;
      await auth.api.acceptInvitation({
        body: { invitationId: params.id },
        headers: request.headers,
      });
    } catch (err) {
      const message = authMessage(err);
      if (message) return fail(400, { error: message });
      throw err;
    }
    redirect(303, `/orgs/${slug}`);
  },

  decline: async ({ params, locals, request }) => {
    if (!locals.user) redirect(303, `/login?next=/invite/${params.id}`);
    try {
      await auth.api.rejectInvitation({
        body: { invitationId: params.id },
        headers: request.headers,
      });
    } catch (err) {
      const message = authMessage(err);
      if (message) return fail(400, { error: message });
      throw err;
    }
    redirect(303, "/orgs");
  },
};
