import * as env from "$app/env/private";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { getRequestEvent } from "$app/server";
import { db } from "./db/index.ts";
import { sendMagicLinkEmail } from "./email.ts";

type ProviderId = "github" | "google" | "discord";

function provider(id: ProviderId) {
  const key = id.toUpperCase() as Uppercase<typeof id>;
  const clientId = env[`${key}_CLIENT_ID`];
  const clientSecret = env[`${key}_CLIENT_SECRET`];
  return clientId && clientSecret ? { [id]: { clientId, clientSecret } } : {};
}

/** OAuth providers with both an ID and a secret configured. */
export const enabledProviders = (["github", "google", "discord"] as const).filter(
  (p) => Object.keys(provider(p)).length > 0,
);

export const auth = betterAuth({
  baseURL: env.ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: { ...provider("github"), ...provider("google"), ...provider("discord") },
  plugins: [
    magicLink({ sendMagicLink: ({ email, url }) => sendMagicLinkEmail(email, url) }),
    sveltekitCookies(getRequestEvent), // must be last
  ],
});
