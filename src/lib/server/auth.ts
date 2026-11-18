import * as env from "$app/env/private";
import { betterAuth } from "better-auth/minimal";
import { magicLink, organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { getRequestEvent } from "$app/server";
import { db } from "./db/index.ts";
import { sendInvitationEmail, sendMagicLinkEmail } from "./email.ts";

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
    magicLink({
      // Email a link to a confirm page instead of the verify endpoint itself.
      // Mail scanners (e.g. Outlook Safe Links) open links before the person
      // does, which would use up the one-time token; they don't click buttons.
      sendMagicLink: ({ email, url }) =>
        sendMagicLinkEmail(email, `${env.ORIGIN}/login/confirm${new URL(url).search}`),
    }),
    organization({
      // Only invited people see an organization's raffles, so an invitation
      // is the whole access grant: it can only be accepted by a signed-in
      // account whose email matches, and better-auth checks that.
      invitationExpiresIn: 7 * 24 * 60 * 60,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      sendInvitationEmail: ({ id, email, organization, inviter }) =>
        sendInvitationEmail(email, {
          orgName: organization.name,
          inviterName: inviter.user.name || inviter.user.email,
          url: `${env.ORIGIN}/invite/${id}`,
        }),
    }),
    sveltekitCookies(getRequestEvent), // must be last
  ],
});
