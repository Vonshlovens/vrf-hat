import { redirect } from "@sveltejs/kit";
import { auth } from "#lib/server/auth.ts";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request }) => {
    await auth.api.signOut({ headers: request.headers });
    redirect(303, "/");
  },
};
