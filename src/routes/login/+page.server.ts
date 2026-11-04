import { fail, redirect } from "@sveltejs/kit";
import { auth, enabledProviders } from "#lib/server/auth.ts";
import type { Actions, PageServerLoad } from "./$types";

/** Only allow same-site return paths. */
function safeNext(value: FormDataEntryValue | string | null): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

export const load: PageServerLoad = ({ locals, url }) => {
  const next = safeNext(url.searchParams.get("next"));
  if (locals.user) redirect(303, next);
  return { providers: enabledProviders, next };
};

export const actions: Actions = {
  social: async ({ request }) => {
    const form = await request.formData();
    const provider = form.get("provider");
    if (!enabledProviders.some((p) => p === provider))
      return fail(400, { error: "Unknown sign-in provider." });
    const result = await auth.api.signInSocial({
      body: {
        provider: provider as (typeof enabledProviders)[number],
        callbackURL: safeNext(form.get("next")),
      },
    });
    if (!result.url) return fail(500, { error: "Couldn't start sign-in. Try again." });
    redirect(303, result.url, { external: true });
  },

  magic: async ({ request }) => {
    const form = await request.formData();
    const email = form.get("email");
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, {
        error: "Enter a valid email address.",
        email: typeof email === "string" ? email : "",
      });
    }
    await auth.api.signInMagicLink({
      body: { email, callbackURL: safeNext(form.get("next")) },
      headers: request.headers,
    });
    return { sent: email };
  },
};
