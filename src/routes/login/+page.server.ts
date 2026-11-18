import { fail, redirect } from "@sveltejs/kit";
import { and, gt, sql } from "drizzle-orm";
import { auth, enabledProviders } from "#lib/server/auth.ts";
import { db } from "#lib/server/db/index.ts";
import { verification } from "#lib/server/db/schema.ts";
import type { Actions, PageServerLoad } from "./$types";

/** Sign-in links one address can be sent in `PER_EMAIL_WINDOW_MS`. */
const PER_EMAIL = 3;
const PER_EMAIL_WINDOW_MS = 15 * 60_000;

/**
 * Why this sign-in email shouldn't be sent, or null. The form calls better-auth
 * on the server, which skips better-auth's own rate limiter, so without this
 * anyone could make the app email any address over and over.
 */
async function signInLimited(
  email: string,
  request: Request,
  platform: App.Platform | undefined,
): Promise<string | null> {
  // Per visitor: Cloudflare's rate limiter (absent in local dev).
  const ip = request.headers.get("cf-connecting-ip");
  const limiter = platform?.env?.SIGNIN_LIMITER;
  if (ip && limiter && !(await limiter.limit({ key: ip })).success) {
    return "Too many sign-in requests. Wait a minute and try again.";
  }
  // Per address: the links better-auth stored recently, expired or not.
  const linkEmail = sql`case when ${verification.value} like '{"type":"magic-link"%'
    then lower(${verification.value}::jsonb->>'email') end`;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(verification)
    .where(
      and(
        sql`${linkEmail} = ${email.toLowerCase()}`,
        gt(verification.createdAt, new Date(Date.now() - PER_EMAIL_WINDOW_MS)),
      ),
    );
  if (n >= PER_EMAIL) {
    return "We've already sent a few links to that address. Check your inbox and junk folder, or try again in 15 minutes.";
  }
  return null;
}

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

  magic: async ({ request, platform }) => {
    const form = await request.formData();
    const email = form.get("email");
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, {
        error: "Enter a valid email address.",
        email: typeof email === "string" ? email : "",
      });
    }
    const limited = await signInLimited(email, request, platform);
    if (limited) return fail(429, { error: limited, email });
    await auth.api.signInMagicLink({
      body: { email, callbackURL: safeNext(form.get("next")) },
      headers: request.headers,
    });
    return { sent: email };
  },
};
