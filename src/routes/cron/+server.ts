import { error } from "@sveltejs/kit";
import { BETTER_AUTH_SECRET } from "$app/env/private";
import { cronToken } from "#lib/cron-token.js";
import { runDue } from "#lib/server/raffles.ts";
import type { RequestHandler } from "./$types";

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Starts scheduled draws that are due and collects results that have landed.
 * Called every minute by the Worker's cron trigger (cloudflare/worker.js).
 */
export const POST: RequestHandler = async ({ request }) => {
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!sameText(given, await cronToken(BETTER_AUTH_SECRET))) error(403, "Not allowed.");
  return Response.json(await runDue(), { headers: { "cache-control": "no-store" } });
};
