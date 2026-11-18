import { error } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { building } from "$app/env";
import { auth } from "#lib/server/auth.ts";
import { svelteKitHandler } from "better-auth/svelte-kit";

/**
 * The only better-auth endpoints a browser reaches directly: the magic link's
 * confirm button and the OAuth providers' redirects back. Everything else
 * (sign-in, organizations, invitations) goes through this app's own form
 * actions, which call `auth.api` on the server and apply the app's checks.
 * Leaving better-auth's full HTTP API open would let any member list every
 * member's email, or rename an organization past the app's length limits.
 */
const BROWSER_AUTH_PATHS = [
  /^\/api\/auth\/magic-link\/verify$/,
  /^\/api\/auth\/callback\/[a-z]+$/,
  // Where better-auth sends a failed sign-in.
  /^\/api\/auth\/error$/,
];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  if (path.startsWith("/api/auth/") && !BROWSER_AUTH_PATHS.some((p) => p.test(path))) {
    error(404, "Not found");
  }

  const session = await auth.api.getSession({ headers: event.request.headers });

  if (session) {
    event.locals.session = session.session;
    event.locals.user = session.user;
  }

  return svelteKitHandler({ event, resolve, auth, building });
};

const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000",
  // Not a script policy: just no framing, plugins or <base> rewrites.
  "content-security-policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export const handle: Handle = async (input) => {
  const response = await handleBetterAuth(input);
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    // Raffle pages list people's names; keep them out of search engines.
    if (input.event.url.pathname.startsWith("/r/")) {
      response.headers.set("x-robots-tag", "noindex");
    }
  } catch {
    // Some responses (e.g. passed-through fetches) have immutable headers.
  }
  return response;
};
